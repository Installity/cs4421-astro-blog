# Stage 1: Install dependencies and build Astro
FROM node:24-alpine AS builder

WORKDIR /app

# Keep dependency installation cached when only source files change
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN ASTRO_OUTPUT=server npm run build

# Retain only dependencies required in production
RUN npm prune --omit=dev


# Stage 2: Run the compiled application
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321

COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4321/api/health', {signal: AbortSignal.timeout(2000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]
