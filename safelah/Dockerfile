# ── SafeLah — Cloud Run Image ────────────────────────────────────────────────
# Node 20 on Debian Bookworm (not -slim so we can install system packages)
FROM node:20-bookworm-slim

WORKDIR /app

# ── System dependencies ───────────────────────────────────────────────────────
# ffmpeg + ffprobe — audio extraction & video metadata
# python3 + pip    — needed to install yt-dlp
# curl / ca-certs  — HTTPS downloads inside container
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      curl \
      ca-certificates \
    && pip3 install --break-system-packages yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Verify binaries are on PATH
RUN ffmpeg -version > /dev/null && \
    ffprobe -version > /dev/null && \
    yt-dlp --version

# ── Node dependencies ─────────────────────────────────────────────────────────
COPY package*.json ./
RUN npm install --production

# ── Application source ────────────────────────────────────────────────────────
COPY . .

# Cloud Run injects PORT=8080 and K_SERVICE (triggers SKIP_WHATSAPP auto-detect)
EXPOSE 8080

# Use non-root user for security
RUN addgroup --system safelah && adduser --system --ingroup safelah safelah
USER safelah

CMD ["node", "server.js"]
