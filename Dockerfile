# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV DATABASE_PATH=:memory:
RUN npm test && npm run check && npm run build && node --test deploy/container-checks.mjs
RUN npm prune --omit=dev

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
ARG APP_VERSION=development
ARG VCS_REF=unknown
ARG SOURCE_URL
LABEL org.opencontainers.image.title="Life Management" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.source=$SOURCE_URL
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends util-linux ca-certificates && rm -rf /var/lib/apt/lists/* \
    && mkdir /data && chown node:node /data && chmod 700 /data
COPY --from=build /app/package.json /app/package-lock.json /app/LICENSE ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY deploy/container-entrypoint.sh deploy/container-start.mjs deploy/container-backup.mjs deploy/container-healthcheck.mjs ./deploy/
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 BODY_SIZE_LIMIT=12M \
    DATABASE_PATH=/data/life.db APP_VERSION=$APP_VERSION
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node", "deploy/container-healthcheck.mjs"]
ENTRYPOINT ["/bin/sh", "/app/deploy/container-entrypoint.sh"]
