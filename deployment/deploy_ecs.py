"""Deploy a tested image through the AWS CLI, preserving Express configuration."""

import copy
import json
import os
import subprocess
import time


def update_request(service, image, allowed_origins):
    configurations = service.get("activeConfigurations", [])
    if len(configurations) != 1:
        raise RuntimeError("Wait for the existing deployment before updating ECS")
    container = copy.deepcopy(configurations[0]["primaryContainer"])
    container["image"] = image
    environment = {item["name"]: item["value"] for item in container.get("environment", [])}
    origins = environment.get("NEWS_ALLOWED_ORIGINS", "").split(",")
    origins += allowed_origins.split(",")
    environment["NEWS_ALLOWED_ORIGINS"] = ",".join(
        dict.fromkeys(origin.strip() for origin in origins if origin.strip())
    )
    container["environment"] = [{"name": key, "value": value} for key, value in environment.items()]
    return {"serviceArn": service["serviceArn"], "primaryContainer": container}


def is_stable(service, ecs, expected_image=None):
    deployments = ecs.get("deployments", [])
    if any(deployment.get("rolloutState") == "FAILED" for deployment in deployments):
        raise RuntimeError("ECS deployment failed; inspect the service events")
    configurations = service.get("activeConfigurations", [])
    if len(configurations) != 1 or len(deployments) != 1:
        return False
    if service.get("status", {}).get("statusCode") != "ACTIVE":
        return False
    configuration = configurations[0]
    deployment = deployments[0]
    return (
        deployment.get("rolloutState") == "COMPLETED"
        and deployment.get("taskDefinition") == configuration.get("taskDefinitionArn")
        and ecs.get("runningCount", 0) == ecs.get("desiredCount", 0)
        and ecs.get("runningCount", 0) > 0
        and ecs.get("pendingCount", 0) == 0
        and (expected_image is None or configuration["primaryContainer"]["image"] == expected_image)
    )


def aws(*arguments):
    result = subprocess.run(
        ["aws", "ecs", *arguments, "--region", os.environ["AWS_REGION"], "--output", "json"],
        capture_output=True, text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)


def wait_for_stable(service_arn, deadline, expected_image=None):
    while time.monotonic() < deadline:
        service = aws("describe-express-gateway-service", "--service-arn", service_arn)["service"]
        result = aws("describe-services", "--cluster", service["cluster"], "--services", service_arn)
        if result.get("failures") or not result.get("services"):
            raise RuntimeError("Unable to inspect the ECS service")
        if is_stable(service, result["services"][0], expected_image):
            return service
        time.sleep(20)
    raise TimeoutError("ECS did not reach a healthy state with the requested image within 25 minutes")


def main():
    service_arn = os.environ["ECS_SERVICE_ARN"]
    image = os.environ["IMAGE_URI"]
    if "@sha256:" not in image:
        raise ValueError("Deploy an immutable image digest, not a mutable tag")
    deadline = time.monotonic() + 25 * 60
    service = wait_for_stable(service_arn, deadline)
    request = update_request(service, image, os.environ["NEWS_ALLOWED_ORIGINS"])
    if request["primaryContainer"] == service["activeConfigurations"][0]["primaryContainer"]:
        print("ECS already runs the requested image and news configuration", flush=True)
        return
    aws("update-express-gateway-service", "--cli-input-json", json.dumps(request))
    print("ECS update started; waiting for completed deployment", flush=True)
    wait_for_stable(service_arn, deadline, image)
    print("ECS deployment completed with healthy running tasks", flush=True)


if __name__ == "__main__":
    main()
