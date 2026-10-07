import type { NewsResponse } from "../lib/news";
for (const section of document.querySelectorAll<HTMLElement>(
  "[data-news-feed]",
)) {
  const endpoint = section.dataset.endpoint;
  if (!endpoint) continue;
  const status = section.querySelector<HTMLElement>("[data-news-status]")!;
  const list = section.querySelector<HTMLUListElement>("[data-news-list]")!;
  const checked = section.querySelector<HTMLElement>("[data-news-checked]")!;
  const filter = section.querySelector<HTMLSelectElement>("[data-news-filter]");
  const retry = section.querySelector<HTMLButtonElement>("[data-news-retry]")!;
  const sources = section.querySelector<HTMLDetailsElement>(
    "[data-news-sources]",
  )!;
  let data: NewsResponse | undefined;
  let busy = false;
  let lastAttempt = 0;
  retry.hidden = false;
  function render() {
    if (!data) return;
    const items = data.items
      .filter(
        (i) => !filter || filter.value === "all" || i.sourceId === filter.value,
      )
      .slice(0, Number(section.dataset.limit));
    list.replaceChildren();
    for (const item of items) {
      const li = document.createElement("li");
      const heading = document.createElement("h3");
      const link = document.createElement("a");
      try {
        if (!["http:", "https:"].includes(new URL(item.url).protocol)) continue;
      } catch {
        continue;
      }
      link.href = item.url;
      link.textContent = item.title;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      heading.append(link);
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = item.sourceName;
      if (item.publishedAt && Number.isFinite(Date.parse(item.publishedAt))) {
        const time = document.createElement("time");
        time.dateTime = item.publishedAt;
        time.textContent = ` · ${new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.publishedAt))}`;
        meta.append(time);
      } else meta.append(" · Date unavailable");
      li.append(heading, meta);
      list.append(li);
    }
    const failed = data.sources.filter((s) => s.status !== "ok");
    status.textContent =
      data.items.length === 0
        ? data.sources.every((s) => s.status === "ok")
          ? "No headlines are available yet."
          : "News is temporarily unavailable. Try again shortly."
        : items.length === 0
          ? "No headlines are available for this publisher."
          : failed.length
            ? `Showing available headlines. ${failed.map((s) => `${s.name} ${s.status === "stale" ? "(cached headlines)" : "(unavailable)"}`).join(", ")}.`
            : `${items.length} latest ${items.length === 1 ? "headline" : "headlines"}.`;
    checked.textContent = Number.isFinite(Date.parse(data.checkedAt))
      ? `Last checked: ${new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.checkedAt))}`
      : "";
    sources.hidden = false;
    const sourceList = sources.querySelector("ul")!;
    sourceList.replaceChildren();
    for (const source of data.sources) {
      const li = document.createElement("li");
      li.textContent = `${source.name}: ${source.status === "ok" ? "available" : source.status === "stale" ? "cached headlines" : "unavailable"}${source.lastSuccessfulFetch ? ` · last fetched ${new Date(source.lastSuccessfulFetch).toLocaleString("en-IE")}` : ""}`;
      sourceList.append(li);
    }
  }
  async function load() {
    if (busy) return;
    busy = true;
    lastAttempt = Date.now();
    retry.disabled = true;
    try {
      const response = await fetch(endpoint!, {
        signal: AbortSignal.timeout(12_000),
        credentials: "omit",
      });
      if (!response.ok && response.status !== 503)
        throw new Error("News request failed");
      const payload = await response.json();
      if (
        !Array.isArray(payload.items) ||
        !Array.isArray(payload.sources) ||
        typeof payload.checkedAt !== "string"
      )
        throw new Error("Invalid news response");
      data = payload;
      render();
    } catch {
      status.textContent = data
        ? "Could not refresh news. Previously loaded headlines remain below."
        : "News is temporarily unavailable. Try again shortly.";
    } finally {
      busy = false;
      retry.disabled = false;
    }
  }
  retry.addEventListener("click", load);
  filter?.addEventListener("change", render);
  setInterval(() => {
    if (!document.hidden && Date.now() - lastAttempt >= 15 * 60_000)
      void load();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastAttempt >= 15 * 60_000)
      void load();
  });
  void load();
}
