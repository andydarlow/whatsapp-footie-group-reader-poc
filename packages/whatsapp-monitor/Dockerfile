FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY package.json ./
RUN npm install -d  --omit=dev

COPY src/ ./src/

# Auth credentials are mounted here from a PersistentVolumeClaim
RUN mkdir -p /data/auth

ENV AUTH_DIR=/data/auth \
    NODE_ENV=production

CMD ["node", "src/index.js"]
