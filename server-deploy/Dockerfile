FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --production

FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY dist/ ./dist/
COPY public/ ./public/
COPY assets/ ./assets/
EXPOSE 3000
CMD ["node", "dist/main.js"]