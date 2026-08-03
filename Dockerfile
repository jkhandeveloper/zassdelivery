# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────
# ZassDelivery API — multi-stage production image
# ─────────────────────────────────────────────────────────────

# ---- Base ---------------------------------------------------
FROM node:24-alpine AS base
# openssl is required by the Prisma query engine on Alpine.
# dumb-init gives us correct PID 1 signal handling for graceful shutdown.
RUN apk add --no-cache openssl dumb-init
WORKDIR /app
ENV NODE_ENV=production

# ---- Dependencies (full, including dev) ---------------------
FROM base AS deps
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build --------------------------------------------------
FROM base AS build
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npm run build

# ---- Production dependencies only ---------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
# Regenerate the client against the pruned tree so @prisma/client is wired up.
RUN npx prisma generate

# ---- Runner -------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node package.json ./
COPY --chown=node:node docker-entrypoint.sh ./

RUN chmod +x ./docker-entrypoint.sh

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
