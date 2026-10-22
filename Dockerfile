# Build: type-check and bundle the app into dist/.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Run: Node 24 runs server/*.ts as they are, serving dist/ and /api/auth/*.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
# The server only reads these files and listens above 1024: no need for root.
USER node
EXPOSE 3000
CMD ["node", "server/main.ts"]
