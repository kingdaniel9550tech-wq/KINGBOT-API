FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# 1. Install system requirements
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    curl \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 2. Create a Python virtual environment (bypasses PEP 668 restrictions completely)
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# 3. Install yt-dlp inside the virtual environment safely
RUN pip install --no-cache-dir --upgrade yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
