FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm@latest

WORKDIR /app

# Copy root config files for pnpm workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json babel.config.js project.config.json eslint.config.mjs ./
COPY config/ ./config/
COPY patches/ ./patches/
COPY types/ ./types/

# Copy server package
COPY server/package.json server/tsconfig.json server/nest-cli.json ./server/

# Copy frontend source
COPY src/ ./src/

# Install all dependencies (root + server/)
RUN pnpm install --frozen-lockfile

# Copy server source code
COPY server/src/ ./server/src/

# Build frontend (H5)
RUN pnpm build:web

# Build server (NestJS)
RUN pnpm build:server

# ====================
# Production stage
FROM node:20-alpine
WORKDIR /app

# Copy production dependencies
COPY server/package.json ./
RUN npm install --production

# Copy built artifacts from builder
COPY --from=builder /app/dist-web/ ./dist-web/
COPY --from=builder /app/server/dist/ ./dist/
COPY --from=builder /app/server/assets/ ./assets/
COPY --from=builder /app/server/scripts/ ./scripts/

EXPOSE 3000
CMD ["node", "dist/main.js"]