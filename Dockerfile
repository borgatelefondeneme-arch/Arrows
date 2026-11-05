FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000 DATA_FILE=/data/players.json
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
