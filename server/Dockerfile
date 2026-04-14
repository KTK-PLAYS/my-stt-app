FROM node:22-slim

# ── system deps — installed once, baked into the image forever ──
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    git \
    unzip \
    curl \
    ca-certificates \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# ── yt-dlp standalone binary — baked into the image ───────────
RUN curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    -o /usr/local/bin/yt-dlp \
 && chmod 755 /usr/local/bin/yt-dlp

# ── bgutil POT provider plugin ─────────────────────────────────
RUN mkdir -p /opt/bgutil-server /opt/yt-dlp-plugins \
 && git clone --depth 1 --single-branch --branch 1.3.1 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-server \
 && cd /opt/bgutil-server/server \
 && npm ci \
 && npx tsc \
 && curl -sL https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip \
    -o /tmp/bgutil-plugin.zip \
 && unzip /tmp/bgutil-plugin.zip -d /opt/yt-dlp-plugins \
 && rm /tmp/bgutil-plugin.zip

# ── app ────────────────────────────────────────────────────────
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.cjs ./

EXPOSE 8080
CMD ["node", "server.cjs"]
