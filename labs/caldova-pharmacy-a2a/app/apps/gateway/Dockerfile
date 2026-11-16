FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/
COPY packages/platform/package.json packages/platform/tsconfig.json packages/platform/
COPY apps/gateway/package.json apps/gateway/tsconfig.json apps/gateway/
COPY apps/orders/package.json apps/orders/tsconfig.json apps/orders/
COPY apps/portal/package.json apps/portal/tsconfig.json apps/portal/vite.config.ts apps/portal/
COPY apps/risk/package.json apps/risk/tsconfig.json apps/risk/
RUN npm ci

COPY packages/contracts/src packages/contracts/src
COPY packages/platform/src packages/platform/src
COPY apps/gateway/src apps/gateway/src
COPY apps/portal/index.html apps/portal/
COPY apps/portal/src apps/portal/src
RUN npm run build --workspace @caldova/contracts \
  && npm run build --workspace @caldova/platform \
  && npm run build --workspace @caldova/gateway \
  && npm run build --workspace @caldova/portal

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORTAL_DIST_PATH=/app/apps/gateway/public
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/platform/package.json packages/platform/
COPY apps/gateway/package.json apps/gateway/
COPY apps/orders/package.json apps/orders/
COPY apps/portal/package.json apps/portal/
COPY apps/risk/package.json apps/risk/
RUN npm ci --omit=dev --ignore-scripts \
  --workspace @caldova/contracts \
  --workspace @caldova/platform \
  --workspace @caldova/gateway \
  && npm cache clean --force

COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/platform/dist packages/platform/dist
COPY --from=build /app/apps/gateway/dist apps/gateway/dist
COPY --from=build /app/apps/portal/dist apps/gateway/public

USER node
EXPOSE 8080
CMD ["node", "--import", "./apps/gateway/dist/instrumentation.js", "./apps/gateway/dist/server.js"]
