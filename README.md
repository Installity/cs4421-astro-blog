# Astro Starter Kit: Blog

```sh
npm create astro@latest -- --template blog
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

Features:

- ✅ Minimal styling (make it your own!)
- ✅ 100/100 Lighthouse performance
- ✅ SEO-friendly with canonical URLs and Open Graph data
- ✅ Sitemap support
- ✅ RSS Feed support
- ✅ Markdown & MDX support

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/
│   ├── layouts/
│   └── pages/
├── astro.config.mjs
├── README.md
├── package.json
└── tsconfig.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

The `src/content/` directory contains "collections" of related Markdown and MDX documents. Use `getCollection()` to retrieve posts from `src/content/blog/`, and type-check your frontmatter using an optional schema. See [Astro's Content Collections docs](https://docs.astro.build/en/guides/content-collections/) to learn more.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `git`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Check out [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Credit

This theme is based off of the lovely [Bear Blog](https://github.com/HermanMartinus/bearblog/).

## Container builds and publishing

The default `npm run build` creates the static site used by the CDK deployment.
The Dockerfile sets `ASTRO_OUTPUT=server` during its build to produce an Astro
Node server with a live `/api/health` endpoint.

With OrbStack running, build and test the container locally:

```sh
docker build --platform linux/amd64 -t astro-blog:local .
docker run -d --platform linux/amd64 --name astro-blog-local \
  -p 4321:4321 -e NODE_ENV=production astro-blog:local
curl --fail http://localhost:4321/api/health
docker inspect astro-blog-local --format '{{.State.Health.Status}}'
```

Stop any development server using port 4321 before starting the container.
Health initially reports `starting`; allow about 30 seconds for the first probe.
Use `docker stop astro-blog-local` and `docker rm astro-blog-local` before
creating a new container from a rebuilt image.

The Continuous Integration workflow runs the existing project checks, then
builds a Linux AMD64 image and verifies its Docker health check on pull requests.
After a push or merge to `main`, it also publishes the tested image to the
`astro-blog` ECR repository in `us-east-1`. The workflow summary records its URI.
Publishing uses the `GitHubActionsAstroECR` IAM role via OIDC, without permanent
AWS access keys. The role trusts only this repository's `main` branch.

The workflow includes defaults for this project's AWS region and publishing role.
Optional repository Actions variables `AWS_REGION` and `AWS_ECR_ROLE_ARN` can
override them; update the role's ECR permissions when changing the destination.
Image tags include the commit SHA, run ID, and attempt, so each run has a unique
tag compatible with the repository's immutable tags. `v1.0.0` remains the lab
release tag. Manual workflow runs validate the image without publishing it.

Publishing an image does not deploy a running container. The existing static CDK
deployment remains a separate workflow.
