# OpenMail — production image
#
# 镜像以 root 运行：容器需要绑定 25 / 143 / 110 等 <1024 的特权端口。
# 若要以非 root 用户运行，需要额外授予 CAP_NET_BIND_SERVICE 能力，并保证
# /app/data、/app/files 对运行用户可写（否则 SQLite 与附件写入会失败）。
FROM node:22-alpine

# OCI 元数据（CI 发布时 docker/metadata-action 还会额外注入 source/revision 等标签）
LABEL org.opencontainers.image.title="OpenMail" \
      org.opencontainers.image.description="Self-hosted open-source mail server suite: SMTP/IMAP/POP3, webmail, admin dashboard, multi-domain, DKIM, anti-spam, 2FA. Zero native dependencies." \
      org.opencontainers.image.source="https://github.com/chenyuwebwawa/OpenMail" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# 依赖先行，利用 Docker 层缓存
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public
COPY langpacks ./langpacks

ENV NODE_ENV=production

EXPOSE 3000 25 587 465 143 993 110 995

VOLUME ["/app/data", "/app/files"]

# 健康检查：GET / 由 Express 返回 public/index.html，是公开路由，未登录也返回 200。
# 不要改成需要认证的接口（例如 /api/auth/me 未登录返回 401，会让容器永久处于 unhealthy）。
# busybox wget 在 HTTP 2xx/3xx 时退出码为 0，非 2xx/3xx（如 401/500）时为 1。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["node", "server/index.js"]
