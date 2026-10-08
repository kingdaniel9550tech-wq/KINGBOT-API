FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get -o Acquire::ForceIPv4=true update && \
    apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install the absolute latest master branch of yt-dlp with --break-system-packages
RUN pip3 install --no-cache-dir --upgrade --force-reinstall --break-system-packages https://github.com/yt-dlp/yt-dlp/archive/master.tar.gz

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
