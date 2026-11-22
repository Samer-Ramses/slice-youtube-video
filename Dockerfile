FROM node:22-bookworm-slim

# تثبيت FFmpeg و Python3/pip و Deno ثم تثبيت yt-dlp[default] + yt-dlp-ejs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    unzip \
    ca-certificates \
  && pip3 install --break-system-packages --no-cache-dir --upgrade "yt-dlp[default]" yt-dlp-ejs \
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

# إعداد مستخدم غير-root (uid 1000 = node) مع صلاحية الكاش لـ yt-dlp
RUN chown -R 1000:1000 /app && mkdir -p /home/node/.cache && chown -R 1000:1000 /home/node
USER 1000

ENV NODE_ENV=production
ENV HOME=/home/node
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV MAX_HEIGHT=720
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

EXPOSE 3000

CMD ["sh", "-c", "./node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
