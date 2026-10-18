# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

# Game server (TypeScript executed by tsx; shared package is consumed from source)
FROM node:24-alpine AS server
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3001
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["npx", "tsx", "apps/server/src/main.ts"]

# Static client + reverse proxy for /ws and /api
FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
EXPOSE 80
