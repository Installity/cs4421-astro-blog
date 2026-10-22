import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const { values } = parseArgs({ options: {
  url: { type: "string" },
  kind: { type: "string", default: "health" },
  samples: { type: "string", default: "1200" },
  interval: { type: "string", default: "1000" },
  timeout: { type: "string", default: "5000" },
} });

const url = new URL(values.url ?? "");
const samples = Number(values.samples);
const interval = Number(values.interval);
const timeout = Number(values.timeout);
if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
  throw new Error("Use an HTTP(S) URL without credentials, query or fragment");
}
if (!["health", "page"].includes(values.kind) ||
    !Number.isInteger(samples) || samples < 1 || samples > 10000 ||
    !Number.isInteger(interval) || interval < 50 || interval > 60000 ||
    !Number.isInteger(timeout) || timeout < 1 || timeout > 30000) {
  throw new Error("Invalid kind, samples, interval or timeout");
}

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
let good = 0;
let observed = 0;
const began = new Date().toISOString();
for (let n = 0; n < samples && !stopping; n++) {
  const started = performance.now();
  const timestamp = new Date().toISOString();
  let statusCode = null;
  let ok = false;
  let failure = null;
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(timeout),
      headers: { "Cache-Control": "no-cache", "User-Agent": "cs4421-availability-probe/1" } });
    statusCode = response.status;
    if (values.kind === "health") {
      const body = await response.json();
      ok = statusCode === 200 && body.status === "ok" && typeof body.uptime === "number";
    } else {
      const body = await response.text();
      ok = statusCode === 200 && /<main[\s>]/i.test(body);
    }
    if (!ok) failure = "unexpected_status_or_content";
  } catch (error) {
    failure = error?.name === "TimeoutError" ? "timeout" : "request_or_body_error";
  }
  observed++;
  if (ok) good++;
  console.log(JSON.stringify({ type: "observation", timestamp, url: url.href,
    statusCode, ok, failure, latencyMs: Math.round((performance.now() - started) * 100) / 100 }));
  // Sequential sampling avoids overlapping requests; slow attempts reduce cadence.
  if (n + 1 < samples && !stopping) await delay(Math.max(0, interval - (performance.now() - started)));
}
console.log(JSON.stringify({ type: "summary", began, ended: new Date().toISOString(),
  planned: samples, observed, good, failed: observed - good, interrupted: stopping,
  interpretation: "Sampled observations only; correlate the complete interval with release evidence" }));
process.exitCode = observed === samples && good === observed ? 0 : 1;
