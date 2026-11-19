FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/root/.deno/bin:$PATH"

RUN apt-get -o Acquire::ForceIPv4=true update && \
    apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    libcurl4-openssl-dev \
    curl \
    ca-certificates \
    ffmpeg \
    unzip \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Deno for yt-dlp JS challenge solving
RUN curl -fsSL https://deno.land/install.sh | sh

# Install yt-dlp + curl-cffi + bgutil PO token provider plugin, then switch yt-dlp to nightly
RUN pip3 install --no-cache-dir --upgrade --break-system-packages \
    "yt-dlp[default,curl-cffi]" \
    "bgutil-ytdlp-pot-provider" && \
    yt-dlp --update-to nightly || true

# Build bgutil POT HTTP server so yt-dlp can generate per-video PO tokens locally
RUN git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-provider && \
    cd /opt/bgutil-provider/server && \
    npm install --omit=dev && \
    npx tsc

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000
CMD ["sh", "-c", "node /opt/bgutil-provider/server/build/main.js --port 4416 & sleep 2 && node server.js"]
