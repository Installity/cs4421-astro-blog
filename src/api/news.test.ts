import type { APIContext } from "astro";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ getNews: vi.fn() }));
vi.mock("../lib/news", async (importOriginal) => {
  const module = await importOriginal<typeof import("../lib/news")>();
  return { ...module, createNewsService: () => state.getNews };
});
import { GET } from "./news";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const context = (origin: string, query = "") =>
  ({
    request: new Request(`https://api.example/api/news${query}`, {
      headers: { Origin: origin },
    }),
  }) as APIContext;
it("returns 503 and source statuses when no usable headlines remain", async () => {
  state.getNews.mockResolvedValue({
    items: [],
    sources: [
      {
        id: "techcentral",
        name: "TechCentral.ie",
        status: "unavailable",
        lastSuccessfulFetch: null,
      },
    ],
    checkedAt: "2026-10-07T12:00:00Z",
  });
  const response = (await GET(context("https://api.example"))) as Response;
  expect(response.status).toBe(503);
  expect((await response.json()).sources[0].status).toBe("unavailable");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(state.getNews).toHaveBeenCalledWith(false);
});
it("returns partial results and configured CORS headers", async () => {
  vi.stubEnv("NEWS_ALLOWED_ORIGINS", "https://static.example");
  state.getNews.mockResolvedValue({
    items: [
      {
        id: "a",
        title: "Story",
        url: "https://example.com/story",
        sourceId: "techcrunch",
        sourceName: "TechCrunch",
        publishedAt: null,
      },
    ],
    sources: [],
    checkedAt: "2026-10-07T12:00:00Z",
  });
  const response = (await GET(context("https://static.example"))) as Response;
  expect(response.status).toBe(200);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
    "https://static.example",
  );
  const disallowed = (await GET(context("https://other.example"))) as Response;
  expect(disallowed.headers.get("Access-Control-Allow-Origin")).toBeNull();
});
it("passes manual revalidation only for an explicit refresh=1 query", async () => {
  state.getNews.mockResolvedValue({
    items: [],
    sources: [],
    checkedAt: "2026-10-22T12:00:00Z",
    refreshDeferred: true,
  });
  const response = (await GET(
    context("https://api.example", "?refresh=1"),
  )) as Response;
  expect(state.getNews).toHaveBeenLastCalledWith(true);
  expect((await response.json()).refreshDeferred).toBe(true);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await GET(context("https://api.example", "?refresh=false"));
  expect(state.getNews).toHaveBeenLastCalledWith(false);
});
