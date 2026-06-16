# Minimal Dockerfile using pre-built artifacts
FROM node:20-alpine
WORKDIR /app

# Install production dependencies (pnpm-friendly via npm)
COPY server/package.json ./
RUN npm install --production --loglevel=error --no-package-lock

# Copy pre-built artifacts
COPY dist-web/ ./public/
COPY server/dist/ ./dist/
COPY server/assets/ ./assets/
COPY server/scripts/ ./scripts/

EXPOSE 3000
CMD ["node", "dist/main.js"]