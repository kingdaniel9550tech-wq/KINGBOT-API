FROM node:18-bullseye
RUN apt-get update && apt-get install -y python3 ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
