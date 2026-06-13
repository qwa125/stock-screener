FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY tsconfig.json ./
COPY nest-cli.json ./
COPY src/ ./src/
RUN npm install && npx nest build

FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist/
COPY public/ ./public/
COPY assets/ ./assets/
EXPOSE 3000
CMD ["node", "dist/main.js"]