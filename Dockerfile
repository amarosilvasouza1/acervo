# syntax=docker/dockerfile:1
# Node 24 is an LTS line. Use --pull when rebuilding to receive security fixes.
FROM node:24-bookworm-slim AS npm-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4310 \
    ACERVO_HOST=0.0.0.0 \
    ACERVO_MODE=cloud \
    ACERVO_DATA_DIR=/app/data \
    ACERVO_PYTHON=/opt/acervo-python/bin/python \
    ACERVO_FFMPEG=/usr/bin/ffmpeg \
    ACERVO_FFPROBE=/usr/bin/ffprobe \
    PYTHONDONTWRITEBYTECODE=1 \
    XDG_CACHE_HOME=/tmp/acervo-cache

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/acervo-python
COPY deploy/requirements.txt /tmp/acervo-requirements.txt
RUN /opt/acervo-python/bin/python -m pip install --no-cache-dir -r /tmp/acervo-requirements.txt \
    && rm /tmp/acervo-requirements.txt
COPY deploy/yt-dlp.conf /etc/yt-dlp.conf

WORKDIR /app
COPY --from=npm-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json server.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node releases ./releases
COPY --chown=node:node deploy/import-data.mjs ./deploy/import-data.mjs
RUN mkdir -p /app/data/tracks /app/data/covers /app/data/tmp /app/data/trash \
    && chown -R node:node /app/data

USER node:node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
