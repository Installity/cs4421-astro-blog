import type { APIContext, MiddlewareNext } from "astro";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "./middleware";

afterEach(() => vi.restoreAllMocks());

const context = (overrides: Partial<APIContext> = {}) => ({
  request: new Request("https://example.test/api/health?token=private-query", {
    headers: { Authorization: "Bearer private-auth", Cookie: "private-cookie" },
  }),
  routePattern: "/api/health",
  isPrerendered: false,
  ...overrides,
}) as APIContext;

describe("structured request logging", () => {
  it.each([[200, "info"], [404, "warn"], [503, "error"]])(
    "preserves a %s response and logs it once at %s level",
    async (status, level) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const response = new Response("original body", { status, headers: { "X-Test": "retained" } });
      const next = vi.fn(async () => response);
      const result = await onRequest(context(), next);
      expect(result).toBe(response);
      expect(await result!.text()).toBe("original body");
      expect(result!.headers.get("X-Test")).toBe("retained");
      expect(next).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledOnce();
      const record = JSON.parse(log.mock.calls[0][0]);
      expect(record).toEqual({
        timestamp: expect.any(String), level, event: "http_request",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), method: "GET",
        route: "/api/health", statusCode: status, latencyMs: expect.any(Number),
      });
      expect(Number.isNaN(Date.parse(record.timestamp))).toBe(false);
      expect(record.latencyMs).toBeGreaterThanOrEqual(0);
      expect(log.mock.calls[0][0]).not.toContain("private");
    },
  );

  it("returns a safe 500 and one error record for an unhandled exception", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await onRequest(context(), async () => { throw new Error("private-upstream-key"); });
    expect(result!.status).toBe(500);
    expect(await result!.text()).toBe("Internal Server Error");
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      statusCode: 500, level: "error", errorCode: "unhandled_request_error",
    });
    expect(log.mock.calls[0][0]).not.toContain("private");
  });

  it("uses a route pattern or safe fallback without reading request payloads", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = new Request("https://example.test/reset/private-path?secret=private-query", {
      method: "POST", body: "private-payload",
    });
    const ctx = context({ request, routePattern: "" });
    await onRequest(ctx, async () => new Response(null, { status: 404 }));
    expect(request.bodyUsed).toBe(false);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ route: "[unmatched]", method: "POST" });
    expect(log.mock.calls[0][0]).not.toContain("private");
  });

  it("gives concurrent requests distinct IDs and records", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await Promise.all([onRequest(context(), async () => new Response()), onRequest(context(), async () => new Response())]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(new Set(log.mock.calls.map(([line]) => JSON.parse(line).requestId)).size).toBe(2);
  });

  it("does not turn prerendering into apparent production requests", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = new Response("static");
    const next: MiddlewareNext = async () => response;
    expect(await onRequest(context({ isPrerendered: true }), next)).toBe(response);
    expect(log).not.toHaveBeenCalled();
  });
});
