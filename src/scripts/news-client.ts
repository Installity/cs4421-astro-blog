import type { NewsResponse } from "../lib/news";

function isNewsResponse(value: unknown): value is NewsResponse {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    Array.isArray(payload.items) &&
    payload.items.every(
      (item) =>
        item &&
        [item.id, item.title, item.url, item.sourceId, item.sourceName].every(
          (v) => typeof v === "string",
        ) &&
        (item.publishedAt === null || typeof item.publishedAt === "string"),
    ) &&
    Array.isArray(payload.sources) &&
    payload.sources.every(
      (source) =>
        source &&
        typeof source.id === "string" &&
        typeof source.name === "string" &&
        ["ok", "stale", "unavailable"].includes(source.status) &&
        (source.lastSuccessfulFetch === null ||
          (typeof source.lastSuccessfulFetch === "string" &&
            Number.isFinite(Date.parse(source.lastSuccessfulFetch)))),
    ) &&
    typeof payload.checkedAt === "string" &&
    Number.isFinite(Date.parse(payload.checkedAt)) &&
    (payload.refreshDeferred === undefined ||
      typeof payload.refreshDeferred === "boolean")
  );
}

const initializedSections = new WeakSet<HTMLElement>();
function initializeNews() {
  for (const section of document.querySelectorAll<HTMLElement>(
    "[data-news-feed]",
  )) {
    const endpoint = section.dataset.endpoint;
    if (!endpoint || initializedSections.has(section)) continue;
    initializedSections.add(section);
    const status = section.querySelector<HTMLElement>("[data-news-status]")!;
    const list = section.querySelector<HTMLUListElement>("[data-news-list]")!;
    const checked = section.querySelector<HTMLElement>("[data-news-checked]")!;
    const filter =
      section.querySelector<HTMLSelectElement>("[data-news-filter]");
    const retry =
      section.querySelector<HTMLButtonElement>("[data-news-retry]")!;
    const refreshLabel = retry.querySelector<HTMLElement>(
      "[data-news-refresh-label]",
    )!;
    const sources = section.querySelector<HTMLDetailsElement>(
      "[data-news-sources]",
    )!;
    const lifecycle = new AbortController();
    const { signal } = lifecycle;
    let data: NewsResponse | undefined;
    let busy = false;
    let lastAttempt = 0;
    let outcome = "";
    let animation: Animation | undefined;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    retry.hidden = false;
    async function fade(from: number, to: number, duration: number) {
      if (reducedMotion.matches || signal.aborted) return;
      animation = list.animate([{ opacity: from }, { opacity: to }], {
        duration,
        easing: "ease-in-out",
        fill: "forwards",
      });
      await animation.finished.catch(() => {});
    }
    function render() {
      if (!data) return;
      const items = data.items
        .filter(
          (i) =>
            !filter || filter.value === "all" || i.sourceId === filter.value,
        )
        .slice(0, Number(section.dataset.limit));
      list.replaceChildren();
      for (const item of items) {
        const li = document.createElement("li");
        const heading = document.createElement("h3");
        const link = document.createElement("a");
        try {
          if (!["http:", "https:"].includes(new URL(item.url).protocol))
            continue;
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
      if (outcome) status.textContent = `${outcome} ${status.textContent}`;
      checked.textContent = Number.isFinite(Date.parse(data.checkedAt))
        ? `Last checked: ${new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(data.checkedAt))}`
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
    async function load(manual = false) {
      if (busy || signal.aborted) return;
      busy = true;
      lastAttempt = Date.now();
      retry.disabled = true;
      refreshLabel.textContent = data ? "Refreshing…" : "Loading…";
      section.setAttribute("data-news-refreshing", "");
      list.setAttribute("aria-busy", "true");
      status.textContent = data
        ? "Refreshing news. Checking the publishers…"
        : "Loading the latest headlines…";
      const request = new AbortController();
      let timeout: ReturnType<typeof setTimeout>;
      // Bound both headers and body reads even if a browser delays rejecting
      // an aborted fetch. Keep the last successful feed available on timeout.
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          request.abort();
          reject(new Error("News request timed out"));
        }, 12_000);
      });
      try {
        const url = new URL(endpoint!, window.location.href);
        if (manual) url.searchParams.set("refresh", "1");
        const response = await Promise.race([
          fetch(url, {
            signal: AbortSignal.any([signal, request.signal]),
            credentials: "omit",
            cache: "no-store",
          }),
          deadline,
        ]);
        if (!response.ok && response.status !== 503)
          throw new Error("News request failed");
        const payload = await Promise.race([response.json(), deadline]);
        if (!isNewsResponse(payload)) throw new Error("Invalid news response");
        if (signal.aborted) return;
        // An unavailable response must not erase headlines already on screen.
        if (
          data?.items.length &&
          !payload.items.length &&
          (!response.ok || payload.sources.some((s) => s.status !== "ok"))
        )
          throw new Error("Publishers unavailable");
        const previous = data;
        const changed =
          JSON.stringify(previous?.items) !== JSON.stringify(payload.items);
        const transition = Boolean(previous?.items.length && changed);
        if (transition) {
          list.style.minHeight = `${list.getBoundingClientRect().height}px`;
          await fade(1, 0, 140);
          if (signal.aborted) return;
        }
        data = payload;
        outcome = previous
          ? data.refreshDeferred
            ? "Checked recently. Showing cached headlines."
            : data.sources.some((s) => s.status !== "ok")
              ? "Refresh complete."
              : changed
                ? "News refreshed."
                : "You’re up to date."
          : "";
        render();
        animation?.cancel();
        if (transition) await fade(0, 1, 180);
      } catch {
        if (signal.aborted) return;
        outcome = data
          ? "Could not refresh news. Previously loaded headlines remain below."
          : "News is temporarily unavailable. Try again shortly.";
        status.textContent = outcome;
      } finally {
        clearTimeout(timeout!);
        busy = false;
        animation?.cancel();
        list.style.removeProperty("min-height");
        if (!signal.aborted) {
          retry.disabled = false;
          refreshLabel.textContent = "Refresh news";
          section.removeAttribute("data-news-refreshing");
          list.setAttribute("aria-busy", "false");
        }
      }
    }
    retry.addEventListener("click", () => void load(true), { signal });
    filter?.addEventListener(
      "change",
      () => {
        animation?.cancel();
        render();
        if (busy)
          status.textContent = "Refreshing news. Checking the publishers…";
      },
      { signal },
    );
    reducedMotion.addEventListener(
      "change",
      () => {
        if (reducedMotion.matches) animation?.cancel();
      },
      { signal },
    );
    const interval = setInterval(() => {
      if (!document.hidden && Date.now() - lastAttempt >= 15 * 60_000)
        void load();
    }, 60_000);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden && Date.now() - lastAttempt >= 15 * 60_000)
          void load();
      },
      { signal },
    );
    document.addEventListener(
      "astro:before-swap",
      () => {
        lifecycle.abort();
        animation?.cancel();
        clearInterval(interval);
        initializedSections.delete(section);
      },
      { once: true, signal },
    );
    void load();
  }
}

// A newly imported inline module can evaluate after the first page-load event.
// Initialize immediately too; the section guard prevents duplicate handlers.
document.addEventListener("astro:page-load", initializeNews);
initializeNews();
