FROM node:18-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get -o Acquire::ForceIPv4=true update && \
    apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Fix python package restriction by adding --break-system-packages
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
