# OpenMail — production image
FROM node:22-alpine

WORKDIR /app

#依赖先行，利用 Docker 层缓存
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public
COPY langpacks ./langpacks

ENV NODE_ENV=production
EXPOSE 3000 25 587 465 143 993 110 995

VOLUME ["/app/data", "/app/files"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/api/auth/me >/dev/null 2>&1 || exit 1

CMD ["node", "server/index.js"]
