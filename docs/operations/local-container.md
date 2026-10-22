# Local container exercise

Related: [#84](https://github.com/Installity/cs4421-astro-blog/issues/84).

Build the repository's existing multi-stage image, then run the isolated check:

```sh
docker build --platform linux/amd64 -t astro-blog:issue-84 .
python3 deployment/check_local_container.py --image astro-blog:issue-84 --port 4321
```

If another service already owns host port 4321, preserve it and pass an unused
port, for example `--port 4338`. The container still binds `0.0.0.0:4321`; the
host side is restricted to loopback. The script generates its own container name,
waits for the real Docker HEALTHCHECK, checks HTTP health, verifies a harmless
runtime environment variable, captures ps/logs/stats, sends SIGTERM with a
10-second stop deadline, inspects exit state, and removes only its own container.
It does not build/push a registry image or alter ECS. Review stdout before saving
it; run only this known local application image, whose logs are included.

The image is the packaged filesystem/configuration; a container is a running
instance with its own lifecycle. The builder installs dependencies and compiles
Astro; the runner uses compiled output and production dependencies as a non-root
user. Runtime variables configure the instance without rebuilding the image.
The news cache is memory-local, not persistent/shared state. Docker health and
HTTP 200 establish process liveness, not publisher freshness or user SLOs.

## Observed execution

An agent-operated run on 2026-10-22 built Linux AMD64 from main `71257ed` plus the
build-context privacy exclusions. Docker 29.4.0 was used. The pre-existing
`my-blog` owned host port 4321, so the exercise mapped host 4338 to container 4321.
The first run observed healthy Docker status, HTTP 200/JSON and runtime
environment injection, but shutdown failed: Docker killed PID 1 after its
10-second deadline (exit 137, no OOM). The standalone listener had no signal
handler. A small launcher now disables adapter autostart, starts the same
standalone listener, and drains HTTP connections on SIGTERM/SIGINT. An eight-second
deadline exits with failure if draining cannot finish. CI now requires exit 0
after stopping the tested container, so health alone cannot hide this regression.

The repeated check at 09:24:54 UTC used local image
`sha256:039d094cee1c091bc6827898b4352ebcdbb31f90f47fda3f37946b1b5234b3c4`.
Docker health was healthy, HTTP health returned 200 with `status=ok`, and the
injected `COURSE_EXERCISE` value was `issue-84`. One diagnostic sample showed
0.00% CPU and 88.78 MiB memory (not a performance benchmark). SIGTERM stopped the
container in 0.178 seconds with exit 0 and no OOM; the generated exercise
container was removed. The pre-existing `my-blog` container remained running.

The local tag identifies this exercise, not an ECR release. The Docker ignore
rules also exclude local guidance/preparation from build context; that exclusion
overlaps the dedicated privacy change in #89. No registry push or cloud mutation
was performed.

This is real operator evidence, not a claim that the student performed the lab.
The student should repeat the commands and explain port mapping, health versus
readiness, environment injection, statelessness and shutdown before #84 closes.
