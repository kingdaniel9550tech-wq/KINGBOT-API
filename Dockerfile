FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies, Python, ffmpeg, and curl
RUN apt-get -o Acquire::ForceIPv4=true update && \
    apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    curl \
    ca-certificates \
    ffmpeg \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Deno (Required for YouTube's JS/n-challenge solving)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV PATH="/root/.deno/bin:$PATH"

# Install master branch of yt-dlp with curl-cffi support for browser impersonation
RUN pip3 install --no-cache-dir --upgrade --force-reinstall --break-system-packages "yt-dlp[default,curl-cffi] @ https://github.com/yt-dlp/yt-dlp/archive/master.tar.gz"

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
