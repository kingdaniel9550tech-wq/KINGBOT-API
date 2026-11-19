FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get -o Acquire::ForceIPv4=true update && \
    apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    ffmpeg \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Deno for yt-dlp JS challenge solving
RUN curl -fsSL https://deno.land/install.sh | sh
ENV PATH="/root/.deno/bin:$PATH"

# Install latest yt-dlp with EJS/challenge support
RUN pip3 install --no-cache-dir --upgrade --break-system-packages "yt-dlp[default]"

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
