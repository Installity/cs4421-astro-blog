"""Inspect an existing local image in an isolated, disposable exercise container."""

import argparse
import datetime
import json
import subprocess
import time
import urllib.request
import uuid


def docker(*arguments):
    return subprocess.run(
        ["docker", *arguments], check=True, capture_output=True, text=True, timeout=120
    ).stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="astro-blog:issue-84")
    parser.add_argument("--port", type=int, default=4321)
    args = parser.parse_args()
    name = "cs4421-exercise-" + uuid.uuid4().hex[:12]
    image = json.loads(docker("image", "inspect", args.image))[0]
    if image["Os"] != "linux" or image["Architecture"] != "amd64":
        raise RuntimeError("Build the exercise image with --platform linux/amd64")
    created = False
    report = {
        "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "imageId": image["Id"], "platform": "linux/amd64", "hostPort": args.port,
        "containerPort": 4321, "container": name,
    }
    try:
        docker("run", "-d", "--name", name, "--platform", "linux/amd64",
               "--label", "cs4421.exercise=local-container",
               "-p", f"127.0.0.1:{args.port}:4321",
               "-e", "NODE_ENV=production", "-e", "HOST=0.0.0.0", "-e", "PORT=4321",
               "-e", "COURSE_EXERCISE=issue-84", args.image)
        created = True
        deadline = time.monotonic() + 100
        while True:
            state = json.loads(docker("inspect", name))[0]["State"]
            health = state.get("Health", {}).get("Status")
            if health == "healthy":
                break
            if not state["Running"] or health == "unhealthy" or time.monotonic() >= deadline:
                raise RuntimeError("Container failed its Docker HEALTHCHECK")
            time.sleep(1)
        with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/api/health", timeout=5) as response:
            body = json.load(response)
            if response.status != 200 or body.get("status") != "ok":
                raise RuntimeError("Application health check failed")
        injected = docker("exec", name, "node", "-p", "process.env.COURSE_EXERCISE")
        if injected != "issue-84":
            raise RuntimeError("Runtime environment injection failed")
        report.update({"health": body, "dockerHealth": health, "environmentInjection": injected,
                       "process": docker("ps", "--filter", f"name=^{name}$", "--format", "{{.Status}}"),
                       "resources": docker("stats", name, "--no-stream", "--format", "{{.CPUPerc}} {{.MemUsage}}"),
                       "logs": docker("logs", name)})
        started = time.monotonic()
        docker("stop", "--timeout", "10", name)
        state = json.loads(docker("inspect", name))[0]["State"]
        report.update({"stopSeconds": round(time.monotonic() - started, 3),
                       "exitCode": state["ExitCode"], "oomKilled": state["OOMKilled"]})
        if state["Running"] or state["ExitCode"] != 0 or state["OOMKilled"]:
            raise RuntimeError("Container did not stop normally after SIGTERM")
    finally:
        if created:
            # Never prune or operate on other containers; this name was generated here.
            docker("rm", "-f", name)
    report["cleanedUp"] = True
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
