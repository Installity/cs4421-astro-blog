import Parser from "rss-parser";
import { decodeHTML } from "entities";

export const NEWS_SOURCES = [
  { id: "techcrunch", name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  {
    id: "the-verge",
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
  },
  {
    id: "ars-technica",
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
  },
  {
    id: "irish-tech-news",
    name: "Irish Tech News",
    url: "https://irishtechnews.ie/feed/",
  },
  {
    id: "techcentral",
    name: "TechCentral.ie",
    url: "https://www.techcentral.ie/feed/",
  },
  {
    id: "techbuzzireland",
    name: "TechBuzzIreland",
    url: "https://techbuzzireland.com/feed/",
  },
] as const;
export interface NewsItem {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string | null;
}
export interface NewsSourceStatus {
  id: string;
  name: string;
  status: "ok" | "stale" | "unavailable";
  lastSuccessfulFetch: string | null;
}
export interface NewsResponse {
  items: NewsItem[];
  sources: NewsSourceStatus[];
  checkedAt: string;
}
const TTL = 15 * 60_000;
const FAILURE_TTL = 60_000;
const MAX_STALE = 24 * 60 * 60_000;
const MAX_BYTES = 2 * 1024 * 1024;
const parser = new Parser();
const order = (a: NewsItem, b: NewsItem) =>
  (b.publishedAt ? Date.parse(b.publishedAt) : -Infinity) -
    (a.publishedAt ? Date.parse(a.publishedAt) : -Infinity) ||
  a.id.localeCompare(b.id);

export async function parseFeed(
  xml: string,
  source: (typeof NEWS_SOURCES)[number],
): Promise<NewsItem[]> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsupported XML declaration");
  const feed = await parser.parseString(xml);
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const item of feed.items) {
    const title = decodeHTML(item.title ?? "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || !item.link) continue;
    let url: URL;
    try {
      url = new URL(item.link);
    } catch {
      continue;
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      continue;
    url.hash = "";
    const date = item.isoDate ?? item.pubDate;
    const publishedAt =
      date && Number.isFinite(Date.parse(date))
        ? new Date(date).toISOString()
        : null;
    items.push({
      id: `${source.id}:${url.href}`,
      title,
      url: url.href,
      sourceId: source.id,
      sourceName: source.name,
      publishedAt,
    });
  }
  return items
    .sort(order)
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, 10);
}

async function readXml(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_BYTES)
    throw new Error("Feed too large");
  if (!response.body) throw new Error("Empty feed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let xml = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("Feed too large");
      xml += decoder.decode(value, { stream: true });
    }
    return xml + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function createNewsService(
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  type Cache = {
    items: NewsItem[];
    successAt?: number;
    checkedAt?: number;
    nextCheck: number;
    failed: boolean;
    pending?: Promise<void>;
  };
  const caches = new Map<string, Cache>();
  async function load(source: (typeof NEWS_SOURCES)[number]) {
    let cache = caches.get(source.id);
    if (!cache) {
      cache = { items: [], nextCheck: 0, failed: false };
      caches.set(source.id, cache);
    }
    const entry = cache;
    if (entry.pending) await entry.pending;
    else if (now() >= entry.nextCheck) {
      entry.pending = (async () => {
        try {
          const response = await fetcher(source.url, {
            signal: AbortSignal.timeout(8000),
            headers: {
              Accept:
                "application/rss+xml, application/atom+xml, application/xml, text/xml",
              "User-Agent": "AndreiSoftwareNotes/1.0 (RSS reader)",
            },
          });
          entry.items = await parseFeed(await readXml(response), source);
          entry.successAt = now();
          entry.failed = false;
          entry.nextCheck = now() + TTL;
        } catch {
          entry.failed = true;
          entry.nextCheck = now() + FAILURE_TTL;
        } finally {
          entry.checkedAt = now();
        }
      })();
      await entry.pending;
      entry.pending = undefined;
    }
    const usable =
      entry.successAt !== undefined && now() - entry.successAt <= MAX_STALE;
    return {
      items: usable ? entry.items : [],
      source: {
        id: source.id,
        name: source.name,
        status: usable ? (entry.failed ? "stale" : "ok") : "unavailable",
        lastSuccessfulFetch:
          entry.successAt !== undefined
            ? new Date(entry.successAt).toISOString()
            : null,
      } as NewsSourceStatus,
      checkedAt: entry.checkedAt ?? now(),
    };
  }
  return async (): Promise<NewsResponse> => {
    const results = await Promise.all(NEWS_SOURCES.map(load));
    const seen = new Set<string>();
    const items = results
      .flatMap((r) => r.items)
      .sort(order)
      .filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
    return {
      items,
      sources: results.map((r) => r.source),
      checkedAt: new Date(
        Math.max(...results.map((r) => r.checkedAt)),
      ).toISOString(),
    };
  };
}

export function newsCorsHeaders(
  origin: string | null,
  requestUrl: string,
  allowed: string,
): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (
    origin &&
    (origin === new URL(requestUrl).origin ||
      allowed
        .split(",")
        .map((s) => s.trim())
        .includes(origin))
  )
    headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
