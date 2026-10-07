import type { APIRoute } from "astro";
import { createNewsService, newsCorsHeaders } from "../lib/news";
const getNews = createNewsService();
export const GET: APIRoute = async ({ request }) => {
  const news = await getNews();
  return new Response(JSON.stringify(news), {
    status: news.items.length ? 200 : 503,
    headers: newsCorsHeaders(
      request.headers.get("Origin"),
      request.url,
      process.env.NEWS_ALLOWED_ORIGINS ?? "",
    ),
  });
};
