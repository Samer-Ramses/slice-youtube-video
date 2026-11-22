FROM node:22-bookworm-slim

# تثبيت FFmpeg و Python3 و curl ثم تنزيل أحدث نسخة Linux من yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# تثبيت الـ dependencies وبناء Next.js
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# إعداد مستخدم غير-root
RUN chown -R 1000:1000 /app
USER 1000

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV MAX_HEIGHT=720
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

EXPOSE 3000

CMD ["sh", "-c", "./node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
