FROM node:20-alpine AS builder
WORKDIR /app
COPY server/package.json ./
COPY server/tsconfig.json ./
COPY server/nest-cli.json ./
COPY server/src/ ./src/
RUN npm install && npx nest build

FROM node:20-alpine
WORKDIR /app
COPY server/package.json ./
RUN npm install --production
COPY --from=builder /app/dist ./dist/
COPY dist-web/ ./dist-web/
COPY server/assets/ ./assets/
COPY server/public/ ./public/
COPY server/scripts/ ./scripts/
EXPOSE 3000
CMD ["node", "dist/main.js"]