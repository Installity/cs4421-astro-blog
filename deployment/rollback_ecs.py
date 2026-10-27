"""Preview or execute recovery of this service using existing, tested artifacts.

Uses the AWS CLI and Python's standard library; never builds or publishes an image.
"""

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from deploy_ecs import is_stable

REGION = "us-east-1"
ACCOUNT = "873716897321"
REPOSITORY = "Installity/cs4421-astro-blog"
SERVICE = f"arn:aws:ecs:{REGION}:{ACCOUNT}:service/default/astro-blog"
REGISTRY = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/astro-blog"
APP_URL = "https://as-2b62f684bea24081892fa30f44c134ca.ecs.us-east-1.on.aws"
ORIGIN = "https://d2lpj15qx37gqq.cloudfront.net"
RELEASE_TAG = re.compile(r"sha-([0-9a-f]{40})-([1-9][0-9]*)-([1-9][0-9]*)\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
TERMINAL = {"SUCCESSFUL", "ROLLBACK_SUCCESSFUL", "ROLLBACK_FAILED", "STOPPED"}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def aws(service, operation, *arguments):
    result = subprocess.run(
        ["aws", service, operation, *arguments, "--region", REGION, "--output", "json",
         "--no-cli-pager", "--no-paginate", "--cli-connect-timeout", "5",
         "--cli-read-timeout", "15"],
        capture_output=True, text=True, timeout=45,
        env={**os.environ, "AWS_MAX_ATTEMPTS": "2", "AWS_PAGER": ""},
    )
    if result.returncode:
        raise RuntimeError(f"AWS {operation} failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def github_run(run_id, attempt):
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN with Actions read permission is required")
    request = Request(
        f"https://api.github.com/repos/{REPOSITORY}/actions/runs/{run_id}/attempts/{attempt}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"},
    )
    with urlopen(request, timeout=15) as response:
        return json.load(response)


def release_image(tag):
    match = RELEASE_TAG.fullmatch(tag)
    if not match:
        raise ValueError("Select a pipeline release tag: sha-<40-character-SHA>-<run-ID>-<attempt>")
    sha, run_id, attempt = match.groups()
    run = github_run(run_id, attempt)
    if not (
        run.get("status") == "completed" and run.get("conclusion") == "success"
        and run.get("event") == "push" and run.get("head_branch") == "main"
        and run.get("head_sha") == sha and run.get("run_attempt") == int(attempt)
        and run.get("path") == ".github/workflows/ci.yml"
        and run.get("repository", {}).get("full_name") == REPOSITORY
    ):
        raise RuntimeError("The tag must identify a successful main-push CI run and attempt")
    result = aws("ecr", "describe-images", "--repository-name", "astro-blog",
                 "--image-ids", f"imageTag={tag}")
    images = result.get("imageDetails", [])
    if len(images) != 1 or not DIGEST.fullmatch(images[0].get("imageDigest", "")):
        raise RuntimeError("ECR did not resolve the tag to exactly one image digest")
    digest = images[0]["imageDigest"]
    return {"tag": tag, "digest": digest, "image": f"{REGISTRY}@{digest}",
            "source_sha": sha, "run_id": run_id, "attempt": int(attempt)}


def deployments():
    items, token, seen = [], None, set()
    while True:
        arguments = ["--cluster", "default", "--service", SERVICE, "--max-results", "100"]
        if token:
            arguments += ["--next-token", token]
        page = aws("ecs", "list-service-deployments", *arguments)
        items.extend(page.get("serviceDeployments", []))
        token = page.get("nextToken")
        if not token:
            return items
        if token in seen:
            raise RuntimeError("ECS returned a repeated pagination token")
        seen.add(token)


def describe(operation, arn, key, option):
    result = aws("ecs", operation, option, arn)
    records = result.get(key, [])
    identity_key = "serviceRevisionArn" if key == "serviceRevisions" else "serviceDeploymentArn"
    if (result.get("failures") or len(records) != 1 or records[0].get("serviceArn") != SERVICE
            or records[0].get(identity_key) != arn):
        raise RuntimeError(f"Unable to inspect exactly one revision/deployment of {SERVICE}")
    return records[0]


def revision(arn):
    return describe("describe-service-revisions", arn, "serviceRevisions", "--service-revision-arns")


def deployment(arn):
    return describe("describe-service-deployments", arn, "serviceDeployments", "--service-deployment-arns")


def main_digest(record):
    images = [item for item in record.get("containerImages", []) if item.get("containerName") == "Main"]
    if len(images) != 1 or not DIGEST.fullmatch(images[0].get("imageDigest", "")):
        raise RuntimeError("Revision has no unambiguous resolved Main container digest")
    return images[0]["imageDigest"]


def current_service():
    result = aws("ecs", "describe-services", "--cluster", "default", "--services", SERVICE)
    if (result.get("failures") or len(result.get("services", [])) != 1
            or result["services"][0].get("serviceArn") != SERVICE):
        raise RuntimeError("Unable to inspect the current ECS service")
    return result["services"][0]


def express_service():
    service = aws("ecs", "describe-express-gateway-service", "--service-arn", SERVICE)["service"]
    if service.get("serviceArn") != SERVICE or len(service.get("activeConfigurations", [])) != 1:
        raise RuntimeError("Express must have exactly one active configuration for image restoration")
    return service


def make_plan(mode, tag):
    selected = release_image(tag)
    history = deployments()
    active = [item for item in history if item.get("status") not in TERMINAL]
    plan = {"mode": mode, "service": SERVICE, "release": selected}
    if mode == "ongoing":
        if len(active) != 1 or active[0].get("status") not in {"PENDING", "IN_PROGRESS"}:
            raise RuntimeError("Expected exactly one PENDING/IN_PROGRESS deployment; otherwise inspect ECS")
        record = deployment(active[0]["serviceDeploymentArn"])
        sources = record.get("sourceServiceRevisions", [])
        if record.get("status") not in {"PENDING", "IN_PROGRESS"} or len(sources) != 1:
            raise RuntimeError("Deployment changed or has an ambiguous recovery source; preview again")
        source = revision(sources[0]["arn"])
        if main_digest(source) != selected["digest"]:
            raise RuntimeError("Previous service revision does not contain the selected tested image")
        plan.update(deployment_arn=record["serviceDeploymentArn"],
                    source_revision=sources[0]["arn"], source_task=source["taskDefinition"],
                    target_revision=record["targetServiceRevision"]["arn"])
    else:
        if active:
            raise RuntimeError("An ECS deployment is still ongoing; use ongoing rollback or wait")
        service = express_service()
        configuration = service["activeConfigurations"][0]
        # Prove this digest was actually used by a successful service deployment,
        # not merely assigned a plausible tag after an unrelated CI run succeeded.
        previous = None
        for item in sorted(history, key=lambda item: item.get("createdAt", ""), reverse=True):
            if item.get("status") == "SUCCESSFUL":
                candidate = revision(item["targetServiceRevisionArn"])
                if main_digest(candidate) == selected["digest"]:
                    previous = candidate["serviceRevisionArn"]
                    break
        if not previous:
            raise RuntimeError("No successful service deployment proves the selected digest; inspect its provenance")
        fingerprint = hashlib.sha256(json.dumps(configuration, sort_keys=True).encode()).hexdigest()
        plan.update(previous_revision=previous, current_task=configuration["taskDefinitionArn"],
                    configuration_hash=fingerprint,
                    current_image=configuration["primaryContainer"]["image"])
    return plan


def health_sample():
    started = time.monotonic()
    sample = {"timestamp": utc_now(), "statusCode": None, "ok": False}
    try:
        request = Request(f"{APP_URL}/api/health", headers={"Cache-Control": "no-cache"})
        with urlopen(request, timeout=3) as response:
            sample["statusCode"] = response.status
            body = json.loads(response.read(65536))
            sample["ok"] = (response.status == 200 and response.geturl() == f"{APP_URL}/api/health"
                            and isinstance(body, dict) and body.get("status") == "ok"
                            and type(body.get("uptime")) in (int, float))
    except HTTPError as error:
        sample["statusCode"] = error.code
        sample["failure"] = "http_error"
        error.close()
    except (URLError, TimeoutError, ValueError, OSError):
        sample["failure"] = "request_or_body_error"
    sample["latencyMs"] = round((time.monotonic() - started) * 1000, 2)
    return sample


class Evidence:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        if any(self.directory.iterdir()):
            raise ValueError("Use a new, empty evidence directory for each recovery run")
        self.stop = threading.Event()
        self.samples = []
        self.thread = None

    def event(self, name, **values):
        record = {"timestamp": utc_now(), "event": name, **values}
        with (self.directory / "events.jsonl").open("a") as stream:
            stream.write(json.dumps(record) + "\n")
        print(json.dumps(record), flush=True)

    def observe(self):
        with (self.directory / "health.jsonl").open("a") as stream:
            while not self.stop.is_set():
                sample = health_sample()
                self.samples.append(sample)
                stream.write(json.dumps(sample) + "\n")
                stream.flush()
                self.stop.wait(1)

    def start(self):
        self.thread = threading.Thread(target=self.observe, daemon=True)
        self.thread.start()

    def finish(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=5)
        self.event("probe_summary", observed=len(self.samples),
                   failed=sum(not sample["ok"] for sample in self.samples),
                   interpretation="Samples from this runner only; not proof of zero downtime or a completed drill")


def verify_application():
    for _ in range(3):
        if not health_sample()["ok"]:
            raise RuntimeError("Post-rollback health verification failed")
        time.sleep(1)
    request = Request(f"{APP_URL}/api/news", headers={"Origin": ORIGIN})
    with urlopen(request, timeout=20) as response:
        body = json.loads(response.read(2 * 1024 * 1024))
        if (response.status != 200 or response.geturl() != f"{APP_URL}/api/news"
                or not isinstance(body, dict) or not isinstance(body.get("items"), list) or not body["items"]
                or response.headers.get("Access-Control-Allow-Origin") != ORIGIN):
            raise RuntimeError("Post-rollback news/CORS verification failed")


def wait_for_recovery(plan, evidence, deadline):
    while time.monotonic() < deadline:
        if plan["mode"] == "ongoing":
            record = deployment(plan["deployment_arn"])
            status = record["status"]
            if status in {"ROLLBACK_FAILED", "STOPPED", "SUCCESSFUL"}:
                raise RuntimeError(f"Requested rollback did not complete: {status}")
            service = current_service()
            settled = (status == "ROLLBACK_SUCCESSFUL"
                       and service.get("taskDefinition") == plan["source_task"]
                       and service.get("runningCount", 0) == service.get("desiredCount", 0)
                       and service.get("runningCount", 0) > 0 and service.get("pendingCount", 0) == 0)
            if settled:
                if main_digest(revision(plan["source_revision"])) != plan["release"]["digest"]:
                    raise RuntimeError("Recovered service revision has the wrong image")
        else:
            result = aws("ecs", "describe-express-gateway-service", "--service-arn", SERVICE)
            settled = is_stable(result["service"], current_service(), plan["release"]["image"])
        if settled:
            evidence.event("ecs_recovery_completed")
            verify_application()
            evidence.event("application_verified", digest=plan["release"]["digest"],
                           checks=["health_200_json_three_times", "nonempty_news", "cloudfront_cors"])
            return
        time.sleep(5)
    raise TimeoutError("Recovery not verified within 25 minutes; inspect ECS and retained observations")


def recover(mode, tag, execute, evidence):
    identity = aws("sts", "get-caller-identity")
    if identity.get("Account") != ACCOUNT:
        raise RuntimeError("Authenticated to the wrong AWS account")
    plan = make_plan(mode, tag)
    (evidence.directory / "plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    evidence.event("plan_verified", **plan, execute=execute)
    if not execute:
        evidence.event("preview_only", message="No cloud change requested; select Execute to perform recovery")
        return
    evidence.start()
    try:
        if make_plan(mode, tag) != plan:
            raise RuntimeError("Recovery target or configuration changed; no mutation submitted, preview again")
        if mode == "ongoing":
            evidence.event("rollback_requested", mode=mode, image=plan["release"]["image"])
            aws("ecs", "stop-service-deployment", "--service-deployment-arn", plan["deployment_arn"],
                "--stop-type", "ROLLBACK")
            evidence.event("rollback_request_accepted")
        else:
            service = express_service()
            configuration = service["activeConfigurations"][0]
            fingerprint = hashlib.sha256(json.dumps(configuration, sort_keys=True).encode()).hexdigest()
            if fingerprint != plan["configuration_hash"]:
                raise RuntimeError("Express configuration changed; no update submitted")
            container = copy.deepcopy(configuration["primaryContainer"])
            container["image"] = plan["release"]["image"]
            if container != configuration["primaryContainer"]:
                evidence.event("rollback_requested", mode=mode, image=plan["release"]["image"])
                aws("ecs", "update-express-gateway-service", "--cli-input-json",
                    json.dumps({"serviceArn": SERVICE, "primaryContainer": container}))
                evidence.event("rollback_request_accepted")
            else:
                evidence.event("already_requested_image", message="No Express update needed; verifying service")
        wait_for_recovery(plan, evidence, time.monotonic() + 25 * 60)
    finally:
        evidence.finish()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["ongoing", "restore-image"], required=True)
    parser.add_argument("--image-tag", required=True)
    parser.add_argument("--execute", action="store_true", help="Mutate ECS; omitted means preview only")
    parser.add_argument("--evidence-dir", default="rollback-evidence")
    arguments = parser.parse_args()
    evidence = Evidence(arguments.evidence_dir)
    result = "failed"
    try:
        recover(arguments.mode, arguments.image_tag, arguments.execute, evidence)
        result = "verified recovery" if arguments.execute else "preview only; no deployment changed"
    except (RuntimeError, ValueError, KeyError, OSError, TimeoutError, subprocess.TimeoutExpired) as error:
        evidence.event("recovery_failed", message=str(error))
        raise SystemExit(1) from None
    finally:
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a") as stream:
                stream.write(f"## ECS rollback\n\nResult: **{result}**\n\n"
                             "See the retained plan, UTC events and health observations in the run artifacts. "
                             "ECS completion and HTTP recovery are separate observations. "
                             "This run alone does not prove zero downtime or a sub-minute drill.\n")


if __name__ == "__main__":
    main()
