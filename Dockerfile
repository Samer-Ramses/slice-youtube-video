FROM node:22-bookworm-slim

# تثبيت FFmpeg و Python3/pip و Deno و git ثم تثبيت yt-dlp[default] + yt-dlp-ejs + bgutil PO Token provider
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    unzip \
    git \
    ca-certificates \
  && pip3 install --break-system-packages --no-cache-dir --upgrade "yt-dlp[default]" yt-dlp-ejs bgutil-ytdlp-pot-provider \
  && BGUTIL_VER=$(python3 -c "import importlib.metadata; print(importlib.metadata.version('bgutil-ytdlp-pot-provider'))") \
  && (git clone --single-branch --depth 1 --branch "$BGUTIL_VER" https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider \
      || git clone --single-branch --depth 1 --branch "v$BGUTIL_VER" https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider \
      || git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider) \
  && cd /opt/bgutil-ytdlp-pot-provider/server && npm ci && npx tsc \
  && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
  && chmod a+rx /usr/local/bin/deno \
  && yt-dlp --version && deno --version \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# تثبيت الـ dependencies وبناء Next.js
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# إعداد مستخدم غير-root (uid 1000 = node) مع صلاحية الكاش لـ yt-dlp و bgutil
RUN chown -R 1000:1000 /app /opt/bgutil-ytdlp-pot-provider \
  && mkdir -p /home/node/.cache && chown -R 1000:1000 /home/node
USER 1000

ENV NODE_ENV=production
ENV HOME=/home/node
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV MAX_HEIGHT=720
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV BGUTIL_SERVER_HOME=/opt/bgutil-ytdlp-pot-provider/server

EXPOSE 3000

CMD ["sh", "-c", "./node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
