FROM node:24-slim AS build
WORKDIR /app
# better-sqlite3 compiles from source when no prebuilt binary matches the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN bun run build && bun install --production --frozen-lockfile

FROM node:24-slim
ENV NODE_ENV=production DATA_DIR=/data CONFIG_PATH=/config/config.yaml
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
ENTRYPOINT ["node","dist/bin.js"]
CMD ["start"]