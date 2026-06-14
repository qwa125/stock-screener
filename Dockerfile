# Minimal production Dockerfile using pre-built artifacts
FROM node:20-alpine
WORKDIR /app

# Copy server production dependencies
COPY server/package.json ./
RUN npm install --production --loglevel=error

# Copy pre-built artifacts
COPY dist-web/ ./public/
COPY server/dist/ ./dist/
COPY server/assets/ ./assets/
COPY server/scripts/ ./scripts/

EXPOSE 3000
CMD ["node", "dist/main.js"]