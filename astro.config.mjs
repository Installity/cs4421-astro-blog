// @ts-check

import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import node from "@astrojs/node";

const isContainerBuild = process.env.ASTRO_OUTPUT === "server";

// https://astro.build/config
export default defineConfig({
  output: isContainerBuild ? "server" : "static",
  adapter: isContainerBuild ? node({ mode: "standalone" }) : undefined,
  site: "https://example.com",
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
