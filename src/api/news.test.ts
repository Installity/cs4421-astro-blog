import type { APIContext } from "astro";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ getNews: vi.fn() }));
vi.mock("../lib/news", async (importOriginal) => {
  const module = await importOriginal<typeof import("../lib/news")>();
  return { ...module, createNewsService: () => state.getNews };
});
import { GET } from "./news";
afterEach(() => vi.unstubAllEnvs());
const context = (origin: string) =>
  ({
    request: new Request("https://api.example/api/news", {
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
