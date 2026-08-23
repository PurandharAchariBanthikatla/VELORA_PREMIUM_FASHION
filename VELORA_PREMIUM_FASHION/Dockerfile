# syntax=docker/dockerfile:1

# ---- deps stage --------------------------------------------------------
# Installs dependencies in isolation so the npm cache layer never ends up
# in the final image, and so `npm ci` (reproducible, lockfile-exact) is
# used instead of `npm install`.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime stage ------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

# dumb-init runs as PID 1 and forwards signals (SIGTERM, SIGINT) to the
# Node process below — without this, Node would be PID 1 directly, which
# on Linux does NOT get default signal handling and can leave the process
# ignoring SIGTERM depending on how the container runtime invokes it.
# dumb-init also reaps any zombie child processes.
RUN apk add --no-cache dumb-init

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY backend ./backend
COPY frontend ./frontend

# Generate backend/data/products.json during Docker image build
RUN npm run build

RUN addgroup -S velora && adduser -S velora -G velora && chown -R velora:velora /app
USER velora

ENV NODE_ENV=production PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "backend/server.js"]
