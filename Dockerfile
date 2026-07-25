FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
# Invoke tsx directly rather than through npx: npx wants a writable HOME
# for its cache, which a non-root k8s securityContext doesn't provide.
CMD ["node_modules/.bin/tsx", "server/index.ts"]
