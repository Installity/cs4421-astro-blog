// @ts-check

import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import { loadEnv } from "vite";

const isContainerBuild = process.env.ASTRO_OUTPUT === "server";
const { PUBLIC_SITE_URL } = loadEnv(process.env.NODE_ENV ?? "production", process.cwd(), "PUBLIC_SITE_URL");

// https://astro.build/config
export default defineConfig({
  output: isContainerBuild ? "server" : "static",
  adapter: isContainerBuild ? node({ mode: "standalone" }) : undefined,
  site: PUBLIC_SITE_URL || "https://d2lpj15qx37gqq.cloudfront.net",
  integrations: [
    mdx(),
    sitemap(),
    {
      name: "runtime-news",
      hooks: {
        "astro:config:setup": ({ command, injectRoute }) => {
          if (isContainerBuild || command === "dev") {
            injectRoute({
              pattern: "/api/news",
              entrypoint: "./src/api/news.ts",
              prerender: false,
            });
          }
        },
      },
    },
  ],
});
