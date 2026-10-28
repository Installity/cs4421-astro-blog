import copy
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

import rollback_ecs as rollback

SHA = "a" * 40
TAG = f"sha-{SHA}-123-1"
GOOD = "sha256:" + "a" * 64
BAD = "sha256:" + "b" * 64
IMAGE = f"{rollback.REGISTRY}@{GOOD}"
DEPLOYMENT = rollback.SERVICE.replace(":service/", ":service-deployment/") + "/release"
SOURCE = rollback.SERVICE.replace(":service/", ":service-revision/") + "/source"
TARGET = SOURCE.replace("/source", "/target")


class RollbackTests(unittest.TestCase):
    def setUp(self):
        # Exercise the Actions summary path locally without writing fixture data
        # into the real CI job summary or sharing output between test cases.
        summary_directory = tempfile.TemporaryDirectory(prefix="rollback-test-summary-")
        self.addCleanup(summary_directory.cleanup)
        self.summary = Path(summary_directory.name) / "summary.md"
        summary_environment = patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(self.summary)})
        summary_environment.start()
        self.addCleanup(summary_environment.stop)
        self.release = {"tag": TAG, "digest": GOOD, "image": IMAGE, "source_sha": SHA,
                        "run_id": "123", "attempt": 1}
        self.run = {"status": "completed", "conclusion": "success", "event": "push",
                    "head_branch": "main", "head_sha": SHA, "run_attempt": 1,
                    "path": ".github/workflows/ci.yml",
                    "repository": {"full_name": rollback.REPOSITORY}}
        self.record = {"serviceArn": rollback.SERVICE, "serviceDeploymentArn": DEPLOYMENT,
                       "createdAt": "2026-10-27T20:18:36.602000+00:00",
                       "status": "IN_PROGRESS", "sourceServiceRevisions": [{"arn": SOURCE}],
                       "targetServiceRevision": {"arn": TARGET}}
        self.completed = {**self.record, "status": "ROLLBACK_SUCCESSFUL",
                          "finishedAt": "2026-10-27T20:21:33.896000+00:00"}
        # Actual canary DescribeServices shape observed during the investigation:
        # no top-level task definition; running workloads have revision summaries.
        self.ecs = {"taskDefinition": None, "runningCount": 1, "desiredCount": 1, "pendingCount": 0,
                    "currentServiceRevisions": [{"arn": SOURCE, "requestedTaskCount": 1,
                                                 "runningTaskCount": 1, "pendingTaskCount": 0}]}
        self.source = {"serviceArn": rollback.SERVICE, "serviceRevisionArn": SOURCE,
                       "taskDefinition": "task:16", "containerImages": [
                           {"containerName": "Main", "imageDigest": GOOD, "image": IMAGE}]}
        self.current = {"serviceArn": rollback.SERVICE, "serviceRevisionArn": TARGET,
                        "taskDefinition": "task:18", "containerImages": [
                            {"containerName": "Main", "imageDigest": BAD,
                             "image": f"{rollback.REGISTRY}@{BAD}"}]}
        self.history = [
            {"status": "SUCCESSFUL", "targetServiceRevisionArn": SOURCE,
             "createdAt": "2026-10-22T10:00:00+00:00"},
            {"status": "SUCCESSFUL", "targetServiceRevisionArn": TARGET,
             "createdAt": "2026-10-27T10:00:00+00:00"},
        ]
        self.service = {"serviceArn": rollback.SERVICE, "activeConfigurations": [{
            "taskDefinitionArn": "task:18", "primaryContainer": {
                "image": f"{rollback.REGISTRY}@{BAD}", "containerPort": 4321,
                "command": ["node", "server.mjs"],
                "environment": [{"name": "PORT", "value": "4321"}],
                "secrets": [{"name": "TOKEN", "valueFrom": "secret-reference"}],
                "awsLogsConfiguration": {"logGroup": "existing", "streamPrefix": "ecs"},
            }}]}

    def test_rejects_untrusted_or_failed_release_before_mutation(self):
        with patch.object(rollback, "aws") as cli:
            for tag in ["latest", "v1.0.0", "$(anything)", TAG + "\n", "sha-abc-1-1"]:
                with self.subTest(tag=tag), self.assertRaises(ValueError):
                    rollback.release_image(tag)
            cli.assert_not_called()
        for field, value in [("conclusion", "failure"), ("head_sha", "b" * 40),
                             ("event", "pull_request"), ("head_branch", "feature"),
                             ("run_attempt", 2), ("path", ".github/workflows/other.yml"),
                             ("repository", {"full_name": "other/repo"})]:
            run = {**self.run, field: value}
            with self.subTest(field=field), patch.object(rollback, "github_run", return_value=run), \
                    patch.object(rollback, "aws") as cli, self.assertRaises(RuntimeError):
                rollback.release_image(TAG)
            cli.assert_not_called()

    def test_resolves_successful_ci_release_to_immutable_digest(self):
        with patch.object(rollback, "github_run", return_value=self.run), \
                patch.object(rollback, "aws", return_value={"imageDetails": [{"imageDigest": GOOD}]}):
            self.assertEqual(rollback.release_image(TAG), self.release)
        with patch.object(rollback, "github_run", return_value=self.run), \
                patch.object(rollback, "aws", return_value={"imageDetails": []}), \
                self.assertRaises(RuntimeError):
            rollback.release_image(TAG)

    def test_reads_all_deployment_pages(self):
        with patch.object(rollback, "aws", side_effect=[
            {"serviceDeployments": [{"status": "SUCCESSFUL"}], "nextToken": "next"},
            {"serviceDeployments": [{"status": "IN_PROGRESS"}]},
        ]) as cli:
            self.assertEqual(len(rollback.deployments()), 2)
            self.assertIn("--next-token", cli.call_args.args)

    def test_refuses_repeated_pagination_tokens(self):
        with patch.object(rollback, "aws", return_value={"nextToken": "same"}), \
                self.assertRaises(RuntimeError):
            rollback.deployments()

    def ongoing_plan(self, history=None):
        with patch.object(rollback, "release_image", return_value=self.release), \
                patch.object(rollback, "deployments", return_value=history if history is not None else [self.record]), \
                patch.object(rollback, "deployment", return_value=self.record), \
                patch.object(rollback, "revision", return_value=self.source):
            return rollback.make_plan("ongoing", TAG)

    def test_selects_exact_ongoing_deployment_and_previous_image(self):
        plan = self.ongoing_plan()
        self.assertEqual(plan["source_revision"], SOURCE)
        self.assertEqual(plan["deployment_arn"], DEPLOYMENT)
        self.source["containerImages"][0]["imageDigest"] = BAD
        with self.assertRaisesRegex(RuntimeError, "does not contain"):
            self.ongoing_plan()

    def test_refuses_missing_multiple_completed_or_already_rolling_back_deployments(self):
        for history in [[], [self.record, self.record], [{**self.record, "status": "SUCCESSFUL"}],
                        [{**self.record, "status": "ROLLBACK_IN_PROGRESS"}]]:
            with self.subTest(history=history), self.assertRaises(RuntimeError):
                self.ongoing_plan(history)
        self.record["sourceServiceRevisions"] = [{"arn": SOURCE}, {"arn": TARGET}]
        with self.assertRaises(RuntimeError):
            self.ongoing_plan()

    def restore_plan(self, history=None):
        history = history if history is not None else [
            {"status": "SUCCESSFUL", "targetServiceRevisionArn": SOURCE}]
        with patch.object(rollback, "release_image", return_value=self.release), \
                patch.object(rollback, "deployments", return_value=history), \
                patch.object(rollback, "express_service", return_value=self.service), \
                patch.object(rollback, "revision", return_value=self.source):
            return rollback.make_plan("restore-image", TAG)

    def test_restore_requires_previously_successful_deployed_digest_and_no_active_update(self):
        self.assertEqual(self.restore_plan()["previous_revision"], SOURCE)
        for history in [[], [self.record], [{"status": "STOPPED"}]]:
            with self.subTest(history=history), self.assertRaises(RuntimeError):
                self.restore_plan(history)
        self.source["containerImages"][0]["imageDigest"] = BAD
        with self.assertRaisesRegex(RuntimeError, "No successful service deployment"):
            self.restore_plan()

    def automatic_plan(self, mode="restore-image", history=None):
        if history is None:
            history = [self.record] if mode == "ongoing" else self.history
        def image_lookup(service, operation, *arguments):
            self.assertEqual((service, operation), ("ecr", "describe-images"))
            return {"imageDetails": [{"imageDigest": GOOD, "imageTags": ["v1.0.0", TAG]}]}
        with patch.object(rollback, "deployments", return_value=history), \
                patch.object(rollback, "deployment", return_value=self.record), \
                patch.object(rollback, "express_service", return_value=self.service), \
                patch.object(rollback, "revision", side_effect=lambda arn: {SOURCE: self.source, TARGET: self.current}[arn]), \
                patch.object(rollback, "github_run", return_value=self.run), \
                patch.object(rollback, "aws", side_effect=image_lookup):
            return rollback.make_plan(mode, "", "automatic")

    def test_automatic_ongoing_uses_exact_source_digest_without_a_tag_input(self):
        plan = self.automatic_plan("ongoing")
        self.assertEqual(plan["release"], self.release)
        self.assertEqual(plan["source_revision"], SOURCE)
        self.assertEqual(plan["image_selection"], "automatic")
        self.assertEqual(plan["deployment_arn"], DEPLOYMENT)

    def test_automatic_restore_uses_latest_different_successful_image_not_list_order(self):
        # Input history is deliberately oldest-first. A newer failed deployment
        # must not enter the candidate set, even if it has a different image.
        plan = self.automatic_plan(history=self.history + [{
            "status": "ROLLBACK_FAILED", "targetServiceRevisionArn": "failed",
            "createdAt": "2026-10-27T11:00:00+00:00"}, {
            "status": "SUCCESSFUL", "targetServiceRevisionArn": "older-unneeded",
            "createdAt": "2026-10-21T10:00:00+00:00"}])
        self.assertEqual(plan["release"], self.release)
        self.assertEqual(plan["previous_revision"], SOURCE)
        self.assertEqual(plan["current_digest"], BAD)
        self.assertEqual(plan["current_revision"], TARGET)

    def test_automatic_restore_uses_ecs_digest_even_if_current_configuration_contains_a_tag(self):
        self.service["activeConfigurations"][0]["primaryContainer"]["image"] = f"{rollback.REGISTRY}:v1.0.0"
        self.assertEqual(self.automatic_plan()["current_digest"], BAD)

    def test_automatic_restore_skips_repeated_deployments_of_the_current_digest(self):
        repeated = {**self.history[1], "createdAt": "2026-10-27T09:00:00+00:00"}
        self.assertEqual(self.automatic_plan(history=self.history + [repeated])["release"]["digest"], GOOD)
        self.source["containerImages"][0]["imageDigest"] = BAD
        with self.assertRaisesRegex(RuntimeError, "different image"):
            self.automatic_plan()

    def test_automatic_restore_refuses_missing_or_ambiguous_history(self):
        for history in [[], [self.history[0]],
                        [{**item, "createdAt": "same"} for item in self.history],
                        [{**self.history[0], "createdAt": ""}, self.history[1]]]:
            with self.subTest(history=history), self.assertRaises(RuntimeError):
                self.automatic_plan(history=history)

    def test_automatic_selection_preserves_active_deployment_guards(self):
        for history in [[], [self.record, self.record],
                        [{**self.record, "status": "ROLLBACK_IN_PROGRESS"}]]:
            with self.subTest(history=history), self.assertRaises(RuntimeError):
                self.automatic_plan("ongoing", history)
        with self.assertRaisesRegex(RuntimeError, "still ongoing"):
            self.automatic_plan(history=self.history + [self.record])
        self.record["sourceServiceRevisions"] = [{"arn": SOURCE}, {"arn": TARGET}]
        with self.assertRaisesRegex(RuntimeError, "ambiguous"):
            self.automatic_plan("ongoing")

    def test_selection_requires_manual_tag_and_never_silently_ignores_an_automatic_tag(self):
        for tag, selection in [("", "manual"), (TAG, "automatic"), (TAG, "unknown")]:
            with self.subTest(selection=selection), patch.object(rollback, "aws") as cli, \
                    patch.object(rollback, "deployments") as history, self.assertRaises(ValueError):
                rollback.make_plan("ongoing", tag, selection)
            cli.assert_not_called()
            history.assert_not_called()
        self.assertEqual(self.ongoing_plan()["image_selection"], "manual")

    def test_automatic_revision_requires_pipeline_tag_and_existing_digest(self):
        for details in [[], [{"imageDigest": BAD, "imageTags": [TAG]}],
                        [{"imageDigest": GOOD, "imageTags": ["latest", "v1.0.0"]}]]:
            with self.subTest(details=details), \
                    patch.object(rollback, "aws", return_value={"imageDetails": details}), \
                    patch.object(rollback, "github_run") as run, self.assertRaises(RuntimeError):
                rollback.release_for_revision(self.source)
            run.assert_not_called()

    def test_automatic_revision_rejects_other_repository_and_missing_main_digest(self):
        for image in ["other.example/astro-blog@" + GOOD, ""]:
            self.source["containerImages"][0]["image"] = image
            with patch.object(rollback, "aws") as cli, self.assertRaisesRegex(RuntimeError, "repository"):
                rollback.release_for_revision(self.source)
            cli.assert_not_called()
        self.source["containerImages"] = []
        with self.assertRaisesRegex(RuntimeError, "unambiguous"):
            rollback.release_for_revision(self.source)

    def test_automatic_revision_tries_another_tag_of_the_same_digest_only_after_invalid_ci(self):
        newer = f"sha-{SHA}-124-1"
        with patch.object(rollback, "aws", return_value={"imageDetails": [
                {"imageDigest": GOOD, "imageTags": [TAG, newer]}]}), \
                patch.object(rollback, "github_run", side_effect=[{**self.run, "conclusion": "failure"}, self.run]) as run:
            self.assertEqual(rollback.release_for_revision(self.source), self.release)
            self.assertEqual(run.call_args_list[0].args, ("124", "1"))
        with patch.object(rollback, "aws", return_value={"imageDetails": [
                {"imageDigest": GOOD, "imageTags": [TAG]}]}), \
                patch.object(rollback, "github_run", return_value={**self.run, "conclusion": "failure"}), \
                self.assertRaisesRegex(RuntimeError, "no successful pipeline"):
            rollback.release_for_revision(self.source)

    def test_automatic_revision_refuses_tag_drift_and_does_not_hide_access_failures(self):
        for failure in [RuntimeError("GitHub unavailable"), OSError("connection failed")]:
            with self.subTest(failure=failure), \
                    patch.object(rollback, "aws", return_value={"imageDetails": [
                        {"imageDigest": GOOD, "imageTags": [TAG]}]}), \
                    patch.object(rollback, "release_image", side_effect=failure), \
                    self.assertRaises(type(failure)):
                rollback.release_for_revision(self.source)
        with patch.object(rollback, "aws", return_value={"imageDetails": [
                {"imageDigest": GOOD, "imageTags": [TAG]}]}), \
                patch.object(rollback, "release_image", return_value={**self.release, "digest": BAD}), \
                self.assertRaisesRegex(RuntimeError, "no longer matches"):
            rollback.release_for_revision(self.source)

    def test_automatic_preview_does_not_mutate_and_execution_reselects_before_mutating(self):
        plan = self.automatic_plan("ongoing")
        with tempfile.TemporaryDirectory() as directory:
            evidence = Mock(directory=Path(directory))
            with patch.object(rollback, "aws", return_value={"Account": rollback.ACCOUNT}) as cli, \
                    patch.object(rollback, "make_plan", return_value=plan) as make:
                rollback.recover("ongoing", "", False, evidence, "automatic")
            self.assertEqual(cli.call_count, 1)
            evidence.start.assert_not_called()
            make.assert_called_once_with("ongoing", "", "automatic")
        with tempfile.TemporaryDirectory() as directory:
            evidence = Mock(directory=Path(directory))
            with patch.object(rollback, "aws", return_value={"Account": rollback.ACCOUNT}) as cli, \
                    patch.object(rollback, "make_plan", side_effect=[plan, {**plan, "source_revision": "changed"}]), \
                    self.assertRaisesRegex(RuntimeError, "changed"):
                rollback.recover("ongoing", "", True, evidence, "automatic")
            self.assertEqual(cli.call_count, 1)
            evidence.finish.assert_called_once()

    def test_action_summary_displays_automatic_selection_provenance_without_runtime_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            summary = Path(directory) / "summary.md"
            with patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(summary)}):
                rollback.summarize_plan(self.automatic_plan(), False)
            text = summary.read_text()
            for expected in ["automatic", "preview only", TAG, GOOD, f"/commit/{SHA}", "/runs/123/attempts/1"]:
                self.assertIn(expected, text)
            self.assertNotIn("secret-reference", text)
            self.assertNotIn("environment", text)

    def test_automatic_execution_uses_the_verified_plan_in_both_modes(self):
        for mode in ["ongoing", "restore-image"]:
            plan = self.automatic_plan(mode)
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                evidence = Mock(directory=Path(directory))
                with patch.object(rollback, "aws", return_value={"Account": rollback.ACCOUNT}) as cli, \
                        patch.object(rollback, "make_plan", return_value=plan) as make, \
                        patch.object(rollback, "express_service", return_value=self.service), \
                        patch.object(rollback, "wait_for_recovery") as wait:
                    rollback.recover(mode, "", True, evidence, "automatic")
                self.assertEqual(make.call_count, 2)
                self.assertTrue(all(call.args == (mode, "", "automatic") for call in make.call_args_list))
                expected = "stop-service-deployment" if mode == "ongoing" else "update-express-gateway-service"
                self.assertEqual(cli.call_args.args[1], expected)
                if mode == "restore-image":
                    self.assertEqual(json.loads(cli.call_args.args[-1])["primaryContainer"]["image"], IMAGE)
                wait.assert_called_once()

    def test_cli_passes_automatic_selection_with_an_empty_tag_and_preserves_manual_usage(self):
        for flags, selection, tag in [(["--image-selection", "automatic"], "automatic", ""),
                                      (["--image-tag", TAG], "manual", TAG)]:
            with self.subTest(selection=selection), \
                    patch("sys.argv", ["rollback_ecs.py", "--mode", "ongoing", *flags]), \
                    patch.object(rollback, "Evidence") as evidence, \
                    patch.object(rollback, "recover") as recover:
                rollback.main()
                recover.assert_called_once_with("ongoing", tag, False, evidence.return_value, selection)

    def test_preview_never_mutates_or_starts_probe(self):
        evidence = Mock()
        with tempfile.TemporaryDirectory() as directory:
            evidence.directory = Path(directory)
            with patch.object(rollback, "aws", return_value={"Account": rollback.ACCOUNT}) as cli, \
                    patch.object(rollback, "make_plan", return_value=self.ongoing_plan()):
                rollback.recover("ongoing", TAG, False, evidence)
                self.assertEqual(cli.call_args.args, ("sts", "get-caller-identity"))
                self.assertEqual(cli.call_count, 1)
                evidence.start.assert_not_called()
                self.assertTrue((evidence.directory / "plan.json").is_file())

    def test_wrong_account_and_stale_plan_never_mutate(self):
        with patch.object(rollback, "aws", return_value={"Account": "wrong"}) as cli, \
                patch.object(rollback, "make_plan") as plan, self.assertRaises(RuntimeError):
            rollback.recover("ongoing", TAG, True, Mock())
        plan.assert_not_called()
        original_plan = self.ongoing_plan()
        with tempfile.TemporaryDirectory() as directory:
            evidence = Mock(directory=Path(directory))
            with patch.object(rollback, "aws", return_value={"Account": rollback.ACCOUNT}) as cli, \
                    patch.object(rollback, "make_plan", side_effect=[
                        original_plan, {**original_plan, "target_revision": "changed"}]), \
                    self.assertRaisesRegex(RuntimeError, "changed"):
                rollback.recover("ongoing", TAG, True, evidence)
            self.assertEqual(cli.call_count, 1)
            self.assertIn(TAG, self.summary.read_text())
            evidence.finish.assert_called_once()

    def test_ongoing_execution_stops_only_the_inspected_deployment(self):
        plan = self.ongoing_plan()
        with tempfile.TemporaryDirectory() as directory:
            evidence = Mock(directory=Path(directory))
            with patch.object(rollback, "aws", return_value={"Account": rollback.ACCOUNT}) as cli, \
                    patch.object(rollback, "make_plan", return_value=plan), \
                    patch.object(rollback, "wait_for_recovery") as wait:
                rollback.recover("ongoing", TAG, True, evidence)
            self.assertEqual(cli.call_args.args, ("ecs", "stop-service-deployment",
                             "--service-deployment-arn", DEPLOYMENT, "--stop-type", "ROLLBACK"))
            wait.assert_called_once()

    def test_restore_changes_only_image_and_preserves_runtime_configuration(self):
        plan = self.restore_plan()
        before = copy.deepcopy(self.service)
        with tempfile.TemporaryDirectory() as directory:
            evidence = Mock(directory=Path(directory))
            with patch.object(rollback, "aws", return_value={"Account": rollback.ACCOUNT}) as cli, \
                    patch.object(rollback, "make_plan", return_value=plan), \
                    patch.object(rollback, "express_service", return_value=self.service), \
                    patch.object(rollback, "wait_for_recovery"):
                rollback.recover("restore-image", TAG, True, evidence)
            request = json.loads(cli.call_args.args[-1])
            expected = copy.deepcopy(before["activeConfigurations"][0]["primaryContainer"])
            expected["image"] = IMAGE
            self.assertEqual(request, {"serviceArn": rollback.SERVICE, "primaryContainer": expected})
            self.assertEqual(self.service, before)

    def test_restore_detects_late_configuration_change(self):
        plan = self.restore_plan()
        self.service["activeConfigurations"][0]["primaryContainer"]["containerPort"] = 8080
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(rollback, "aws", return_value={"Account": rollback.ACCOUNT}) as cli, \
                    patch.object(rollback, "make_plan", return_value=plan), \
                    patch.object(rollback, "express_service", return_value=self.service), \
                    self.assertRaisesRegex(RuntimeError, "configuration changed"):
                rollback.recover("restore-image", TAG, True, Mock(directory=Path(directory)))
            self.assertEqual(cli.call_count, 1)

    def test_no_success_claim_for_accepted_but_failed_rollback(self):
        for status in ["ROLLBACK_FAILED", "STOPPED", "SUCCESSFUL"]:
            with self.subTest(status=status), \
                    patch.object(rollback, "deployment", return_value={"status": status}), \
                    patch.object(rollback, "verify_application") as verify, self.assertRaises(RuntimeError):
                rollback.wait_for_recovery(self.ongoing_plan(), Mock(), float("inf"))
            verify.assert_not_called()

    def test_wait_requires_requested_source_running_and_functional_verification(self):
        plan = self.ongoing_plan()
        other = {**self.ecs, "currentServiceRevisions": [
            {**self.ecs["currentServiceRevisions"][0], "arn": TARGET}]}
        evidence = Mock()
        with patch.object(rollback, "deployment", return_value=self.completed), \
                patch.object(rollback, "deployments", return_value=[self.record]), \
                patch.object(rollback, "current_service", side_effect=[other, self.ecs, self.ecs]), \
                patch.object(rollback, "revision", return_value=self.source), \
                patch.object(rollback, "verify_application") as verify, patch.object(rollback.time, "sleep") as sleep:
            rollback.wait_for_recovery(plan, evidence, float("inf"))
            sleep.assert_called_once_with(5)
            verify.assert_called_once()
        with self.assertRaises(TimeoutError):
            rollback.wait_for_recovery(plan, Mock(), 0)

    def test_canary_recovery_uses_revision_summaries_even_without_task_definition(self):
        plan = self.ongoing_plan()
        for top_level in [None, "task:18", "task:16"]:
            with self.subTest(taskDefinition=top_level):
                self.assertTrue(rollback.recovered_source_is_running(
                    plan, {**self.ecs, "taskDefinition": top_level}))
        missing = copy.deepcopy(self.ecs)
        missing.pop("taskDefinition")
        self.assertTrue(rollback.recovered_source_is_running(plan, missing))
        self.assertFalse(rollback.recovered_source_is_running(plan, {
            "taskDefinition": "task:16", "runningCount": 1, "desiredCount": 1, "pendingCount": 0}))

    def test_recovered_revision_requires_complete_capacity_and_no_other_workload(self):
        plan = self.ongoing_plan()
        for change in [{"runningCount": 0}, {"runningCount": 2}, {"desiredCount": 0},
                       {"pendingCount": 1}, {"currentServiceRevisions": []}]:
            with self.subTest(change=change):
                self.assertFalse(rollback.recovered_source_is_running(plan, {**self.ecs, **change}))
        for change in [{"requestedTaskCount": 0}, {"runningTaskCount": 0},
                       {"pendingTaskCount": 1}, {"arn": TARGET}]:
            with self.subTest(change=change):
                altered = {**self.ecs, "currentServiceRevisions": [
                    {**self.ecs["currentServiceRevisions"][0], **change}]}
                self.assertFalse(rollback.recovered_source_is_running(plan, altered))
        for key in ["requestedTaskCount", "runningTaskCount", "pendingTaskCount"]:
            other = {"arn": TARGET, "requestedTaskCount": 0, "runningTaskCount": 0, "pendingTaskCount": 0}
            self.assertTrue(rollback.recovered_source_is_running(plan, {
                **self.ecs, "currentServiceRevisions": [*self.ecs["currentServiceRevisions"], other]}))
            other[key] = 1
            self.assertFalse(rollback.recovered_source_is_running(plan, {
                **self.ecs, "currentServiceRevisions": [*self.ecs["currentServiceRevisions"], other]}))

    def test_canary_wait_still_requires_aws_completion_and_matching_image(self):
        plan = self.ongoing_plan()
        with patch.object(rollback, "deployment", side_effect=[self.record, self.completed]), \
                patch.object(rollback, "deployments", return_value=[self.record]), \
                patch.object(rollback, "current_service", return_value=self.ecs), \
                patch.object(rollback, "revision", return_value=self.source), \
                patch.object(rollback, "verify_application") as verify, patch.object(rollback.time, "sleep") as sleep:
            rollback.wait_for_recovery(plan, Mock(), float("inf"))
            sleep.assert_called_once_with(5)
            verify.assert_called_once()
        wrong_image = copy.deepcopy(self.source)
        wrong_image["containerImages"][0]["imageDigest"] = BAD
        for wrong in [wrong_image, {**self.source, "taskDefinition": "task:wrong"}]:
            with self.subTest(source=wrong), \
                    patch.object(rollback, "deployment", return_value=self.completed), \
                    patch.object(rollback, "deployments", return_value=[self.record]), \
                    patch.object(rollback, "current_service", return_value=self.ecs), \
                    patch.object(rollback, "revision", return_value=wrong), \
                    patch.object(rollback, "verify_application") as verify, \
                    self.assertRaisesRegex(RuntimeError, "wrong task definition or image"):
                rollback.wait_for_recovery(plan, Mock(), float("inf"))
            verify.assert_not_called()

    def test_later_release_is_reported_before_and_during_application_verification(self):
        plan = self.ongoing_plan()
        later = {**self.record, "serviceDeploymentArn": DEPLOYMENT + "-later",
                 "createdAt": "2026-10-27T20:28:41+00:00"}
        for history, expected_checks in [([[self.record, later]], 0),
                                         ([[self.record], [self.record, later]], 1)]:
            evidence = Mock()
            with self.subTest(history=history), \
                    patch.object(rollback, "deployment", return_value=self.completed), \
                    patch.object(rollback, "deployments", side_effect=history), \
                    patch.object(rollback, "current_service", return_value=self.ecs), \
                    patch.object(rollback, "revision", return_value=self.source), \
                    patch.object(rollback, "verify_application") as verify, \
                    self.assertRaisesRegex(RuntimeError, "later ECS deployment superseded"):
                rollback.wait_for_recovery(plan, evidence, float("inf"))
            self.assertEqual(verify.call_count, expected_checks)
            evidence.event.assert_any_call("recovery_superseded", deployment_arn=later["serviceDeploymentArn"],
                                           status="IN_PROGRESS", rollback_status="ROLLBACK_SUCCESSFUL")
            self.assertNotIn("application_verified", [call.args[0] for call in evidence.event.call_args_list])

    def test_revision_change_during_application_checks_is_not_reported_as_success(self):
        plan = self.ongoing_plan()
        evidence = Mock()
        with patch.object(rollback, "deployment", return_value=self.completed), \
                patch.object(rollback, "deployments", return_value=[self.record]), \
                patch.object(rollback, "current_service", side_effect=[self.ecs, {**self.ecs, "pendingCount": 1}]), \
                patch.object(rollback, "revision", return_value=self.source), \
                patch.object(rollback, "verify_application"), \
                self.assertRaisesRegex(RuntimeError, "changed during application verification"):
            rollback.wait_for_recovery(plan, evidence, float("inf"))
        self.assertNotIn("application_verified", [call.args[0] for call in evidence.event.call_args_list])

    def test_wait_records_only_changed_safe_state_and_propagates_application_failure(self):
        plan = self.ongoing_plan()
        evidence = Mock()
        service = {**self.ecs, "environment": [{"name": "TOKEN", "value": "do-not-log"}]}
        with patch.object(rollback, "deployment", side_effect=[self.record, self.record, self.completed]), \
                patch.object(rollback, "deployments", return_value=[self.record]), \
                patch.object(rollback, "current_service", return_value=service), \
                patch.object(rollback, "revision", return_value=self.source), \
                patch.object(rollback, "verify_application", side_effect=RuntimeError("News failed")), \
                patch.object(rollback.time, "sleep"), self.assertRaisesRegex(RuntimeError, "News failed"):
            rollback.wait_for_recovery(plan, evidence, float("inf"))
        observed = [call for call in evidence.event.call_args_list if call.args[0] == "ecs_recovery_observed"]
        self.assertEqual(len(observed), 2)
        self.assertNotIn("do-not-log", str(evidence.event.call_args_list))
        self.assertNotIn("application_verified", [call.args[0] for call in evidence.event.call_args_list])

    def test_health_records_http_failure_and_rejects_invalid_json_shape(self):
        error = HTTPError(rollback.APP_URL, 500, "failure", {}, BytesIO(b""))
        with patch.object(rollback, "urlopen", side_effect=error):
            sample = rollback.health_sample()
            self.assertEqual(sample["statusCode"], 500)
            self.assertFalse(sample["ok"])
        response = Mock(status=200)
        response.read.return_value = b"[]"
        with patch.object(rollback, "urlopen") as opener:
            opener.return_value.__enter__.return_value = response
            self.assertFalse(rollback.health_sample()["ok"])

    def test_health_requires_real_content_and_endpoint(self):
        response = Mock(status=200)
        response.geturl.return_value = f"{rollback.APP_URL}/api/health"
        with patch.object(rollback, "urlopen") as opener:
            opener.return_value.__enter__.return_value = response
            for body, expected in [({"status": "ok", "uptime": 4.5}, True),
                                   ({"status": "error", "uptime": 1}, False),
                                   ({"status": "ok", "uptime": True}, False)]:
                response.read.return_value = json.dumps(body).encode()
                self.assertEqual(rollback.health_sample()["ok"], expected)
            response.geturl.return_value = "https://other.example/health"
            response.read.return_value = b'{"status":"ok","uptime":1}'
            self.assertFalse(rollback.health_sample()["ok"])

    def test_verification_rejects_empty_news_and_wrong_cors_after_healthy_probe(self):
        response = Mock(status=200)
        response.geturl.return_value = f"{rollback.APP_URL}/api/news"
        with patch.object(rollback, "health_sample", return_value={"ok": True}), \
                patch.object(rollback.time, "sleep"), patch.object(rollback, "urlopen") as opener:
            opener.return_value.__enter__.return_value = response
            for items, bad_origin in [([], None), ([{}], rollback.ORIGIN),
                                      ([{}], "https://andreitrn.me"), ([{}], "https://www.andreitrn.me"),
                                      ([{}], None)]:
                response.read.return_value = json.dumps({"items": items}).encode()
                def reply(request, timeout):
                    origin = request.get_header("Origin")
                    response.headers = {"Access-Control-Allow-Origin": "https://wrong.example"
                                        if origin == bad_origin else origin}
                    return opener.return_value
                opener.side_effect = reply
                opener.reset_mock()
                if items and bad_origin is None:
                    rollback.verify_application()
                    self.assertEqual([call.args[0].get_header("Origin") for call in opener.call_args_list],
                                     list(rollback.STATIC_ORIGINS))
                else:
                    with self.assertRaises(RuntimeError):
                        rollback.verify_application()

    def test_evidence_retains_failed_and_successful_samples_without_runtime_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = rollback.Evidence(directory)
            failed = {"timestamp": "before", "ok": False, "statusCode": 500}
            good = {"timestamp": "after", "ok": True, "statusCode": 200}
            with patch.object(rollback, "health_sample", side_effect=[failed, good]), \
                    patch.object(evidence.stop, "wait", side_effect=lambda _: evidence.stop.set()
                                 if len(evidence.samples) == 2 else None):
                evidence.observe()
            samples = [json.loads(line) for line in (Path(directory) / "health.jsonl").read_text().splitlines()]
            self.assertEqual(samples, [failed, good])
            plan = self.restore_plan()
            self.assertNotIn("secret-reference", json.dumps(plan))
            self.assertNotIn("environment", json.dumps(plan))

    def test_evidence_cannot_overwrite_an_earlier_run(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / "plan.json"
            original.write_text("original evidence")
            with self.assertRaisesRegex(ValueError, "new, empty"):
                rollback.Evidence(directory)
            self.assertEqual(original.read_text(), "original evidence")


if __name__ == "__main__":
    unittest.main()
