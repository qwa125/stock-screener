# ====================
# Builder stage
# ====================
FROM node:20-bookworm-slim AS builder

# Install build tools (needed for some native deps)
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm (pin to v9 to match lockfile)
RUN npm install -g pnpm@9

WORKDIR /app

# Copy dependency manifests first (Docker layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json babel.config.js eslint.config.mjs project.config.json ./
COPY config/ ./config/
COPY patches/ ./patches/
COPY types/ ./types/

# Copy server package manifest
COPY server/package.json server/tsconfig.json server/nest-cli.json ./server/

# Copy frontend source
COPY src/ ./src/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy server source code
COPY server/src/ ./server/src/

# Build frontend (H5)
RUN pnpm build:web

# Build server (NestJS)
RUN pnpm build:server

# ====================
# Production stage
# ====================
FROM node:20-alpine
WORKDIR /app

# Copy production dependencies
COPY server/package.json ./
RUN npm install --production --loglevel=error

# Copy built artifacts
COPY --from=builder /app/dist-web/ ./public/
COPY --from=builder /app/server/dist/ ./dist/
COPY --from=builder /app/server/assets/ ./assets/
COPY --from=builder /app/server/scripts/ ./scripts/

EXPOSE 3000
CMD ["node", "dist/main.js"]