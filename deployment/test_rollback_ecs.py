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
        self.release = {"tag": TAG, "digest": GOOD, "image": IMAGE, "source_sha": SHA,
                        "run_id": "123", "attempt": 1}
        self.run = {"status": "completed", "conclusion": "success", "event": "push",
                    "head_branch": "main", "head_sha": SHA, "run_attempt": 1,
                    "path": ".github/workflows/ci.yml",
                    "repository": {"full_name": rollback.REPOSITORY}}
        self.record = {"serviceArn": rollback.SERVICE, "serviceDeploymentArn": DEPLOYMENT,
                       "status": "IN_PROGRESS", "sourceServiceRevisions": [{"arn": SOURCE}],
                       "targetServiceRevision": {"arn": TARGET}}
        self.source = {"serviceArn": rollback.SERVICE, "serviceRevisionArn": SOURCE,
                       "taskDefinition": "task:16", "containerImages": [
                           {"containerName": "Main", "imageDigest": GOOD}]}
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
        with tempfile.TemporaryDirectory() as directory:
            evidence = Mock(directory=Path(directory))
            with patch.object(rollback, "aws", return_value={"Account": rollback.ACCOUNT}) as cli, \
                    patch.object(rollback, "make_plan", side_effect=[{"target": "old"}, {"target": "new"}]), \
                    self.assertRaisesRegex(RuntimeError, "changed"):
                rollback.recover("ongoing", TAG, True, evidence)
            self.assertEqual(cli.call_count, 1)
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
        service = {"taskDefinition": "wrong", "runningCount": 1, "desiredCount": 1, "pendingCount": 0}
        evidence = Mock()
        with patch.object(rollback, "deployment", return_value={"status": "ROLLBACK_SUCCESSFUL"}), \
                patch.object(rollback, "current_service", side_effect=[service, {**service, "taskDefinition": "task:16"}]), \
                patch.object(rollback, "revision", return_value=self.source), \
                patch.object(rollback, "verify_application") as verify, patch.object(rollback.time, "sleep") as sleep:
            rollback.wait_for_recovery(plan, evidence, float("inf"))
            sleep.assert_called_once_with(5)
            verify.assert_called_once()
        with self.assertRaises(TimeoutError):
            rollback.wait_for_recovery(plan, Mock(), 0)

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
            for items, origin, expected in [([], rollback.ORIGIN, False),
                                             ([{}], "https://wrong.example", False),
                                             ([{}], rollback.ORIGIN, True)]:
                response.read.return_value = json.dumps({"items": items}).encode()
                response.headers = {"Access-Control-Allow-Origin": origin}
                if expected:
                    rollback.verify_application()
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
