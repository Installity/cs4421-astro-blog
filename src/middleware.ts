import { randomUUID } from "node:crypto";
import { defineMiddleware } from "astro:middleware";

// Log application response generation, not prerender/build activity or socket time.
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next();

  const started = performance.now();
  const requestId = randomUUID();
  // Route patterns avoid logging user-supplied slugs, queries, or unknown paths.
  const route = context.routePattern || "[unmatched]";
  let statusCode = 500;
  let unhandledError = false;

  try {
    const response = await next();
    statusCode = response.status;
    return response;
  } catch {
    // Do not log exception messages/stacks, which may contain upstream secrets.
    // Returning here also avoids a second middleware pass for an error page.
    unhandledError = true;
    return new Response("Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } finally {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info",
      event: "http_request",
      requestId,
      method: context.request.method,
      route,
      statusCode,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      ...(unhandledError ? { errorCode: "unhandled_request_error" } : {}),
    }));
  }
});
