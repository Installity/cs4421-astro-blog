import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNewsService,
  NEWS_SOURCES,
  newsCorsHeaders,
  parseFeed,
} from "./news";
const rss = (
  url = "https://example.com/story",
  date = "Wed, 07 Oct 2026 10:00:00 GMT",
) =>
  `<rss version="2.0"><channel><title>Test</title><item><title>Example &amp; news</title><link>${url}</link><pubDate>${date}</pubDate></item></channel></rss>`;
const fetchRss = () =>
  vi
    .fn<typeof fetch>()
    .mockImplementation(
      async (url) =>
        new Response(
          rss(
            `https://example.com/${NEWS_SOURCES.find((s) => s.url === url)?.id}`,
          ),
        ),
    );
afterEach(() => vi.useRealTimers());
describe("feed normalisation", () => {
  it("parses RSS with plain titles, validated links and ISO dates", async () => {
    expect(await parseFeed(rss(), NEWS_SOURCES[0])).toEqual([
      {
        id: "techcrunch:https://example.com/story",
        title: "Example & news",
        url: "https://example.com/story",
        sourceId: "techcrunch",
        sourceName: "TechCrunch",
        publishedAt: "2026-10-07T10:00:00.000Z",
      },
    ]);
  });
  it("parses Atom alternate links and published dates", async () => {
    const xml =
      '<feed xmlns="http://www.w3.org/2005/Atom"><title>Test</title><entry><title>Atom story</title><id>id-1</id><link href="https://example.com/atom" rel="alternate"/><published>2026-10-07T12:00:00Z</published><updated>2026-10-07T13:00:00Z</updated></entry></feed>';
    const items = await parseFeed(xml, NEWS_SOURCES[1]);
    expect(items[0]).toMatchObject({
      url: "https://example.com/atom",
      publishedAt: "2026-10-07T12:00:00.000Z",
    });
  });
  it("decodes publisher HTML entities while keeping titles plain text", async () => {
    const xml = '<rss version="2.0"><channel><title>Test</title><item><title><![CDATA[ChatGPT&#8217;s &lsquo;UI&rsquo; &amp; &lt;b&gt;news&lt;/b&gt;]]></title><link>https://example.com/story</link></item></channel></rss>';
    expect((await parseFeed(xml, NEWS_SOURCES[0]))[0].title).toBe("ChatGPT’s ‘UI’ & news");
  });
  it("drops invalid links and blanks, normalises invalid dates and duplicate fragments", async () => {
    expect(
      await parseFeed(rss("javascript:alert(1)"), NEWS_SOURCES[0]),
    ).toEqual([]);
    expect(
      await parseFeed(rss("https://user:pass@example.com/"), NEWS_SOURCES[0]),
    ).toEqual([]);
    const xml =
      '<rss version="2.0"><channel><title>Test</title><item><title><![CDATA[<b>Story</b>]]></title><link>https://example.com/a#one</link><pubDate>wrong</pubDate></item><item><title>Duplicate</title><link>https://example.com/a#two</link></item><item><title> </title><link>https://example.com/b</link></item></channel></rss>';
    expect(await parseFeed(xml, NEWS_SOURCES[0])).toHaveLength(1);
    expect((await parseFeed(xml, NEWS_SOURCES[0]))[0]).toMatchObject({
      title: "Story",
      publishedAt: null,
      url: "https://example.com/a",
    });
  });
  it("rejects malformed XML and entity declarations", async () => {
    await expect(parseFeed("<rss><broken>", NEWS_SOURCES[0])).rejects.toThrow();
    await expect(
      parseFeed("<!DOCTYPE rss><rss/>", NEWS_SOURCES[0]),
    ).rejects.toThrow();
  });
  it("selects the ten newest valid items and puts undated items last", async () => {
    const items = Array.from(
      { length: 12 },
      (_, i) =>
        `<item><title>Story ${i}</title><link>https://example.com/${i}</link><pubDate>${new Date(Date.UTC(2026, 9, i + 1)).toUTCString()}</pubDate></item>`,
    ).join("");
    const result = await parseFeed(
      `<rss version="2.0"><channel><title>Test</title>${items}<item><title>Undated</title><link>https://example.com/undated</link></item></channel></rss>`,
      NEWS_SOURCES[0],
    );
    expect(result).toHaveLength(10);
    expect(result[0].title).toBe("Story 11");
    expect(result.at(-1)?.title).toBe("Story 2");
  });
});
describe("news cache and failures", () => {
  it("combines sources and deduplicates matching article URLs", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(rss()));
    // Each fetch needs its own body stream.
    fetcher.mockImplementation(async () => new Response(rss()));
    const result = await createNewsService(fetcher)();
    expect(result.items).toHaveLength(1);
    expect(result.sources.every((s) => s.status === "ok")).toBe(true);
  });
  it("shares concurrent refreshes and honours the 15-minute cache", async () => {
    let now = 1_000;
    const fetcher = fetchRss();
    const service = createNewsService(fetcher, () => now);
    await Promise.all([service(), service(), service()]);
    expect(fetcher).toHaveBeenCalledTimes(6);
    now += 14 * 60_000;
    await service();
    expect(fetcher).toHaveBeenCalledTimes(6);
    now += 60_000;
    await service();
    expect(fetcher).toHaveBeenCalledTimes(12);
  });
  it("returns partial results on HTTP 403 and retries failures after one minute", async () => {
    let now = 1000;
    const fetcher = fetchRss();
    fetcher.mockImplementation(
      async (url) =>
        new Response(rss(String(url)), {
          status: url === NEWS_SOURCES[4].url ? 403 : 200,
        }),
    );
    const service = createNewsService(fetcher, () => now);
    const result = await service();
    expect(result.items).toHaveLength(5);
    expect(result.sources[4].status).toBe("unavailable");
    await service();
    expect(fetcher).toHaveBeenCalledTimes(6);
    now += 60_000;
    await service();
    expect(fetcher).toHaveBeenCalledTimes(7);
  });
  it("retains stale results through failures and expires them after 24 hours", async () => {
    let now = 1000;
    const fetcher = fetchRss();
    const service = createNewsService(fetcher, () => now);
    await service();
    fetcher.mockRejectedValue(new Error("Network down"));
    now += 15 * 60_000;
    const stale = await service();
    expect(stale.items).toHaveLength(6);
    expect(stale.sources.every((s) => s.status === "stale")).toBe(true);
    now += 24 * 60 * 60_000;
    const expired = await service();
    expect(expired.items).toEqual([]);
    expect(expired.sources.every((s) => s.status === "unavailable")).toBe(true);
  });
  it("enforces the eight-second abort signal", async () => {
    vi.useFakeTimers();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
      });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options?.signal?.addEventListener("abort", () =>
              reject(new Error("Timeout")),
            ),
          ),
      );
    const result = createNewsService(fetcher)();
    await vi.advanceTimersByTimeAsync(8000);
    expect((await result).items).toEqual([]);
    expect(timeout).toHaveBeenCalledTimes(6);
    expect(timeout).toHaveBeenCalledWith(8000);
    timeout.mockRestore();
  });
  it("rejects feeds exceeding declared or streamed size", async () => {
    const tooBig = new Response("x", {
      headers: { "Content-Length": String(2 * 1024 * 1024 + 1) },
    });
    const declared = await createNewsService(
      vi.fn<typeof fetch>().mockImplementation(async () => tooBig.clone()),
    )();
    expect(declared.items).toEqual([]);
    const streamed = await createNewsService(
      vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
        ),
    )();
    expect(streamed.sources.every((s) => s.status === "unavailable")).toBe(
      true,
    );
  });
});
describe("CORS", () => {
  it("allows only same-origin or configured exact origins and varies by Origin", () => {
    const url = "https://api.example/api/news";
    expect(
      newsCorsHeaders(
        "https://site.example",
        url,
        "https://site.example, https://second.example",
      ).get("Access-Control-Allow-Origin"),
    ).toBe("https://site.example");
    expect(
      newsCorsHeaders("https://evil.example", url, "https://site.example").get(
        "Access-Control-Allow-Origin",
      ),
    ).toBeNull();
    expect(
      newsCorsHeaders("https://api.example", url, "").get(
        "Access-Control-Allow-Origin",
      ),
    ).toBe("https://api.example");
    expect(newsCorsHeaders(null, url, "*").get("Vary")).toBe("Origin");
  });
});
