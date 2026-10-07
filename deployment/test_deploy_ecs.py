import copy
import unittest
from unittest.mock import patch

from deploy_ecs import is_stable, update_request, wait_for_stable


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.service = {
            "serviceArn": "service",
            "cluster": "cluster",
            "status": {"statusCode": "ACTIVE"},
            "activeConfigurations": [{
                "taskDefinitionArn": "task:2",
                "primaryContainer": {
                    "image": "image@sha256:old", "containerPort": 4321,
                    "command": ["node", "entry.mjs"],
                    "awsLogsConfiguration": {"logGroup": "existing"},
                    "secrets": [{"name": "SECRET", "valueFrom": "existing-reference"}],
                    "environment": [
                        {"name": "PORT", "value": "4321"},
                        {"name": "NEWS_ALLOWED_ORIGINS", "value": "https://existing.example"},
                    ],
                },
            }],
        }
        self.ecs = {
            "runningCount": 1, "desiredCount": 1, "pendingCount": 0,
            "deployments": [{"taskDefinition": "task:2", "rolloutState": "COMPLETED"}],
        }

    def test_preserves_container_settings_and_merges_origins(self):
        before = copy.deepcopy(self.service)
        request = update_request(self.service, "image@sha256:new", "https://static.example,https://existing.example")
        container = request["primaryContainer"]
        self.assertEqual(container["image"], "image@sha256:new")
        for field in ("containerPort", "command", "awsLogsConfiguration", "secrets"):
            self.assertEqual(container[field], before["activeConfigurations"][0]["primaryContainer"][field])
        environment = {item["name"]: item["value"] for item in container["environment"]}
        self.assertEqual(environment["PORT"], "4321")
        self.assertEqual(environment["NEWS_ALLOWED_ORIGINS"], "https://existing.example,https://static.example")
        self.assertEqual(self.service, before)
        self.assertEqual(set(request), {"serviceArn", "primaryContainer"})

    def test_rejects_overlapping_deployments(self):
        self.service["activeConfigurations"] *= 2
        with self.assertRaises(RuntimeError):
            update_request(self.service, "image", "https://static.example")
        self.assertFalse(is_stable(self.service, self.ecs))

    def test_requires_completed_running_requested_image(self):
        self.assertTrue(is_stable(self.service, self.ecs, "image@sha256:old"))
        self.assertFalse(is_stable(self.service, self.ecs, "image@sha256:new"))
        self.ecs["deployments"][0]["rolloutState"] = "IN_PROGRESS"
        self.assertFalse(is_stable(self.service, self.ecs))
        self.ecs["deployments"][0]["rolloutState"] = "COMPLETED"
        self.ecs["runningCount"] = 0
        self.assertFalse(is_stable(self.service, self.ecs))

    def test_rejects_wrong_task_definition_and_pending_tasks(self):
        self.ecs["deployments"][0]["taskDefinition"] = "task:1"
        self.assertFalse(is_stable(self.service, self.ecs))
        self.ecs["deployments"][0]["taskDefinition"] = "task:2"
        self.ecs["pendingCount"] = 1
        self.assertFalse(is_stable(self.service, self.ecs))

    def test_reports_failed_rollout(self):
        self.ecs["deployments"][0]["rolloutState"] = "FAILED"
        with self.assertRaises(RuntimeError):
            is_stable(self.service, self.ecs)

    def test_waits_for_requested_image(self):
        new = copy.deepcopy(self.service)
        new["activeConfigurations"][0]["primaryContainer"]["image"] = "image@sha256:new"
        with patch("deploy_ecs.aws", side_effect=[
            {"service": self.service}, {"services": [self.ecs]},
            {"service": new}, {"services": [self.ecs]},
        ]) as cli, patch("deploy_ecs.time.sleep"):
            result = wait_for_stable("service", float("inf"), "image@sha256:new")
        self.assertEqual(cli.call_count, 4)
        self.assertEqual(result, new)

    def test_timeout_and_missing_service(self):
        with patch("deploy_ecs.aws") as cli:
            with self.assertRaises(TimeoutError):
                wait_for_stable("service", 0)
            cli.assert_not_called()
        with patch("deploy_ecs.aws", side_effect=[{"service": self.service}, {"services": [], "failures": [{}]}]):
            with self.assertRaises(RuntimeError):
                wait_for_stable("service", float("inf"))
