# Swasthya Setu: one container runs the API and serves the built PWA.
#   docker build -t swasthya-setu .
#   docker compose up          (with PostgreSQL, see docker-compose.yml)

# ---- build the PWA ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --ignore-scripts
COPY shared shared
COPY client client
RUN npm run build

# ---- run ----
FROM node:24-slim
# ffmpeg converts SOS voice messages for speech-to-text.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production FFMPEG_PATH=/usr/bin/ffmpeg PORT=4000
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --ignore-scripts --workspace server --workspace shared && npm cache clean --force
COPY shared shared
COPY server server
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
