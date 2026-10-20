# Docker 部署指南 / Docker Guide

本文覆盖 OpenMail 的 Docker 镜像来源、本地构建、Compose 部署、发布机制、TLS、升级、备份与常见故障。
源码/手动安装、systemd 部署请看 [DEPLOYMENT.md](DEPLOYMENT.md)；项目总览见 [../README.zh-CN.md](../README.zh-CN.md)。

---

## 1. 镜像从哪里来？

**结论：官方镜像同时发布在 Docker Hub 与 GHCR，均为多架构、可直接拉取。**

历史上旧版 README 曾让用户直接 `docker run ... chenyuwebwawa/openmail`（Docker Hub），但仓库当时既没有 CI 工作流，也没有任何已发布的包，
所以会得到 `repository does not exist` / `manifest unknown`。现在仓库内置了自动发布工作流，并已在两个仓库实际发布：

| 镜像仓库 | 地址 | 是否需要配置 | 说明 |
| --- | --- | --- | --- |
| **Docker Hub（推荐，Public）** | `docker.io/chenyutech/openmail` | 需要 `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` 两个仓库 Secret（本仓库已配置） | push 到 `main` / 打 `v*` 标签 / 手动触发时自动构建发布；工作流会自动把仓库设为 Public 并验证匿名拉取 |
| **GHCR** | `ghcr.io/chenyuwebwawa/openmail` | 不需要 Secret（使用内置 `GITHUB_TOKEN`） | 与 Docker Hub 同时发布；包默认可能是 private，匿名拉取前需在 Packages 里改成 Public 或 `docker login ghcr.io`（见第 3 节） |

- 发布逻辑全部在 [../.github/workflows/docker-publish.yml](../.github/workflows/docker-publish.yml) 中，**无需人工登录任何 registry**。
- Docker Hub 镜像命名空间来自仓库 Secret `DOCKERHUB_USERNAME`（当前为 `chenyutech`）；Fork 后配置自己的两个 Secret 即可发布到自己的账号。
- 对普通用户来说，**最稳的方式仍然是第 2 节的源码构建**；预构建镜像（第 3 节）是锦上添花。

## 2. 方式 A：源码构建 + Compose 部署（推荐，任何环境都可用）

前置要求：Docker 20.10+、Docker Compose v2 与 buildx 插件（`docker buildx version` 可确认；Docker Desktop
以及主流发行版的 `docker-buildx-plugin` / `docker-compose-plugin` 包都自带）。

```bash
git clone https://github.com/chenyuwebwawa/OpenMail.git
cd OpenMail

cp .env.example .env          # 至少修改下面这些项
# 编辑 .env：OM_PRIMARY_DOMAIN / OM_BASE_URL / 中继 / TLS

docker compose up -d --build  # 构建镜像并后台启动
docker compose logs -f        # 首次启动查看管理员初始密码
```

首次启动会用 `OM_PRIMARY_DOMAIN` 创建主域名和 DKIM 密钥，并自动创建管理员账号；密码会打印在日志里，同时写入
`data/admin-credentials.txt`。之后打开 `http://服务器IP:3000/`（或你的反代域名）登录。

`.env` 中最少需要关注：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `OM_PRIMARY_DOMAIN` | `example.com` | 主邮件域名，首次启动自动建域 |
| `OM_BASE_URL` | `https://mail.example.com` | 对外访问地址（密码重置链接等使用） |
| `OM_ADMIN_EMAIL` | `admin@example.com` | 首次启动创建的管理员 |
| `OM_SECRET` | `openssl rand -hex 32` 的输出 | 加密 AI Key 的服务端密钥，见第 7 节 |
| `OM_RELAY_HOST/PORT/USER/PASS` | `smtp.sendgrid.net` / `587` / `apikey` / `SG.xxxx` | 云厂商封 25 出站时必配 |
| `OM_TLS_CERT` / `OM_TLS_KEY` | `/certs/fullchain.pem` 等 | **容器内路径**，需先把证书挂载进容器 |

`docker-compose.yml` 通过 `${VAR:-默认值}` 读取同目录 `.env`，所有 `OM_*` 变量都生效（不再有硬编码配置）。
数据持久化：

| 宿主机目录 | 容器内 | 内容 |
| --- | --- | --- |
| `./data` | `/app/data` | SQLite（`openmail.db` + WAL）、自签/自动生成的证书、`secret.key`、`admin-credentials.txt` |
| `./files` | `/app/files` | 邮件附件 |
| `./certs`（可选） | `/certs:ro` | 外部 TLS 证书，配合 `OM_TLS_CERT=/certs/...` |

## 3. 方式 B：使用预构建镜像（Docker Hub / GHCR）

镜像由 GitHub Actions 自动发布到 Docker Hub（`docker.io/chenyutech/openmail`，Public）与 GHCR（`ghcr.io/chenyuwebwawa/openmail`），两个仓库标签一致：

| 触发 | 产物标签 |
| --- | --- |
| push 到 `main` | `latest`、`sha-<短提交>` |
| push `v1.2.3` 标签 | `1.2.3`、`1.2`、`v1.2.3`、`sha-<短提交>` |
| 手动 `workflow_dispatch` | 同当前 ref 的规则（`main` 上会得到 `latest`） |

```bash
# 方式 1：Docker Hub（Public，可匿名拉取）
docker pull chenyutech/openmail:latest

# 方式 2：GHCR（若包为 private，先登录：PAT 需勾选 read:packages）
# docker login ghcr.io -u <github 用户名>
docker pull ghcr.io/chenyuwebwawa/openmail:latest

docker run -d --name openmail --restart unless-stopped \
  -p 3000:3000 -p 25:25 -p 587:587 -p 465:465 \
  -p 143:143 -p 993:993 -p 110:110 -p 995:995 \
  -v openmail-data:/app/data -v openmail-files:/app/files \
  -e OM_PRIMARY_DOMAIN=example.com \
  -e OM_BASE_URL=https://mail.example.com \
  chenyutech/openmail:latest        # 或 ghcr.io/chenyuwebwawa/openmail:latest
```

> `OM_SECRET` 可省略：留空时首次启动会自动生成并持久化到数据卷内的 `/app/data/secret.key`，重建容器不会失效；
> 如需显式设置，请保持固定值 —— 修改会导致已保存的 AI Key 全部失效（详见第 7 节）。

或者仍然用 Compose，只是不再本地构建（把镜像名写进 `.env` 后 `up`）：

```bash
cp .env.example .env
# 任选一个仓库（标签一致）：
echo "OPENMAIL_IMAGE=chenyutech/openmail:latest" >> .env
# echo "OPENMAIL_IMAGE=ghcr.io/chenyuwebwawa/openmail:latest" >> .env
docker compose up -d            # 不会构建；直接使用预构建镜像
docker compose pull             # 以后升级只需 pull + up -d
```

> 本仓库已发布两个仓库的镜像；刚 fork 的仓库或 Actions 尚未跑过时还没有包，`docker pull` 会报
> `manifest unknown` / `repository does not exist` —— 请改用第 2 节源码构建，或到仓库
> **Actions → Docker Image → Run workflow** 手动发布一次（GHCR 匿名拉取前还需把包设为 Public）。

### 多架构说明

发布工作流同时构建 `linux/amd64` 与 `linux/arm64`（通过 QEMU + Buildx），普通 x86 服务器、Apple Silicon、
ARM 云主机（如 Oracle Ampere、AWS Graviton）都可以直接 `docker pull`。本地源码构建默认只构建当前机器架构，
若交叉构建需要：

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t openmail:local .
```

可以用 `docker manifest inspect chenyutech/openmail:latest`（或 GHCR 地址）查看某标签包含哪些架构。

## 4. 维护者：如何启用 / 修改自动发布

1. **让工作流生效**：把仓库推到 GitHub（默认分支 `main`），仓库 Settings → Actions → General 允许 Actions 运行。
   推送到 `main` 会自动触发一次发布；也可以在 **Actions → Docker Image → Run workflow** 手动触发。
2. **GHCR 不需要任何 Secret**：工作流使用内置的 `GITHUB_TOKEN`，并已声明 `permissions: packages: write`。
   首次发布后如需匿名拉取，到仓库主页 → **Packages** → 选中 `openmail` → **Package settings** →
   Danger Zone → **Change visibility** → **Public**（组织/用户级 Packages 设置中操作）。
3. **Docker Hub（已配置）**：
   - Docker Hub → Account Settings → **Personal access tokens** → Generate new token，权限选择 **Read & Write**；
   - GitHub 仓库 → Settings → Secrets and variables → Actions → 两个 Repository secrets：
     `DOCKERHUB_USERNAME`（Docker Hub 用户名，同时作为镜像命名空间；当前为 `chenyutech`）、
     `DOCKERHUB_TOKEN`（上一步的 Access Token）；
   - 两个 Secret 都存在时，工作流会登录 Docker Hub 并推送同一组标签到 `docker.io/<DOCKERHUB_USERNAME>/openmail`；
     首次 push 会自动创建仓库，随后自动把仓库可见性设为 **Public** 并用匿名 token 验证 `manifests/latest` 可拉取；
   - 检测通过 step output 完成（`secrets.*` 不能直接写在 `if:` 表达式里），未配置时该分支步骤自动跳过。
4. **PR 校验**：所有 Pull Request 都会跑 `build` job（`push: false` 只构建 amd64），Dockerfile 写坏会直接红叉。
5. **缓存**：两个 job 都使用 `type=gha` 缓存，重复构建会快很多。

## 5. 端口、防火墙与 DNS

| 端口 | 协议/用途 | 是否必须公网开放 |
| --- | --- | --- |
| 25/tcp | SMTP MX 收信（服务器之间投递） | 必须（否则收不到外网邮件） |
| 587/tcp | Submission（客户端认证发信，STARTTLS） | 建议 |
| 465/tcp | SMTPS（隐式 TLS 发信） | 可选 |
| 143/tcp | IMAP（STARTTLS） | 建议 |
| 993/tcp | IMAPS（隐式 TLS） | 建议 |
| 110/tcp | POP3（STARTTLS） | 可选 |
| 995/tcp | POP3S（隐式 TLS） | 可选 |
| 3000/tcp | Webmail / 管理后台 / REST API | 建议只对反代开放，公网走 443 |

```bash
sudo ufw allow 22/tcp
sudo ufw allow 25,587,465/tcp
sudo ufw allow 143,993/tcp
sudo ufw allow 110,995/tcp
sudo ufw allow 80,443/tcp
sudo ufw enable
```

云厂商**安全组**同样要放行以上端口（入方向），出方向放行 25/587；国内云厂商通常封禁出站 25，需要工单解封或配置
`OM_RELAY_*` 中继。DNS（A / MX / SPF / DKIM / DMARC / PTR）配置见 [DNS-Guide.md](DNS-Guide.md)。

> Compose 中的端口映射是固定的 `3000:3000`、`25:25`……。如果你修改 `.env` 里的 `OM_HTTP_PORT` / `OM_SMTP_PORT`
> 等变量，必须同步修改 `docker-compose.yml` 中对应端口映射的两侧（容器侧要与变量一致），否则容器监听端口和映射会对不上。

## 6. TLS 与反向代理

- **邮件协议**（SMTP STARTTLS、SMTPS 465、IMAPS 993、POP3S 995）依赖 OpenMail 自己持有证书：把 PEM 证书挂载进容器，
  并在 `.env` 中写入**容器内路径**，例如：

  ```yaml
  # docker-compose.yml volumes 中取消注释
  - ./certs:/certs:ro
  ```

  ```ini
  # .env
  OM_TLS_CERT=/certs/fullchain.pem
  OM_TLS_KEY=/certs/privkey.pem
  ```

  Let's Encrypt 证书续期后需要重启容器使其重新加载：`docker compose restart openmail`。
- **Web TLS** 建议由 Nginx / Caddy 等反代终结，容器只在内网监听 3000：

  ```nginx
  server {
      listen 443 ssl http2;
      server_name mail.example.com;
      ssl_certificate     /etc/letsencrypt/live/mail.example.com/fullchain.pem;
      ssl_certificate_key /etc/letsencrypt/live/mail.example.com/privkey.pem;

      location / {
          proxy_pass http://127.0.0.1:3000;
          proxy_set_header Host $host;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          client_max_body_size 30m;   # 附件上传
      }
  }
  ```

  如果 Nginx 跑在容器里，注意把 `127.0.0.1:3000` 换成宿主机地址或 Docker 网络内的服务名。
- 端口全部映射到宿主机时，也可以只让防火墙放行 443、把 3000 限制为内网访问。

## 7. `OM_SECRET` 语义（重要）

- 用途：加密保存在数据库中的 **AI API Key**（AES-256-GCM，密钥由 `sha256("openmail-ai:" + OM_SECRET)` 派生）。
- **未设置**：容器启动时自动生成一个随机密钥并持久化到 `data/secret.key`（即宿主机 `./data/secret.key`），
  重建/升级容器不会丢失；但不建议依赖随机值，生产环境应在 `.env` 中固定。
- **修改它**（或删除 `data/secret.key`）：已保存的 AI API Key 将无法解密，等同于失效，需要在管理后台重新填写。
- 生成示例：`openssl rand -hex 32`。不要使用示例值、不要提交 `.env` 或 `data/secret.key` 到 Git。
- 备份 `./data` 时请连同 `secret.key` 一起备份，否则恢复后 AI Key 需要重新配置。

## 8. 健康检查

镜像内建 `HEALTHCHECK`，每 30 秒请求一次公开路由 `GET /`（返回 `public/index.html`，HTTP 200，无需登录）：

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
```

> 不要把探针改成 `/api/auth/me` 之类的需登录接口：未登录时它返回 401，wget 退出码非 0，容器会**永久 unhealthy**。

```bash
docker compose ps                                  # STATUS 列显示 healthy
docker inspect -f '{{.State.Health.Status}}' openmail
docker inspect -f '{{json .State.Health}}' openmail | head -c 600
```

若显示 `unhealthy`：先 `docker compose logs --tail=100 openmail` 看启动错误，再确认容器内 `OM_HTTP_PORT`
与 Compose 端口映射一致（默认都是 3000）。`start-period=20s` 内的失败不计入重试。

## 9. 升级

| 部署方式 | 升级命令 | 说明 |
| --- | --- | --- |
| 源码构建（方式 A） | `git pull && docker compose up -d --build` | 会重新构建镜像；升级前建议备份 `./data` `./files` |
| 预构建镜像（方式 B） | `docker compose pull && docker compose up -d` | 拉取新 `latest`/指定 tag 后重建容器 |
| 指定版本 / 回退 | `OPENMAIL_IMAGE=chenyutech/openmail:latest docker compose up -d` | 用 semver 或 `sha-xxxx` 标签固定版本（GHCR 地址同理） |

- Docker Hub 与 GHCR 镜像内容一致，可任选；Docker Hub 地址为 `docker.io/chenyutech/openmail`（支持匿名拉取）。
- `scripts/update.sh` **只适用于源码/systemd 安装**，不要在 Docker 部署上运行它。
- 升级前建议先按下一节备份 `./data` 与 `./files`（尤其数据库与 `secret.key`）。

## 10. 备份与恢复

必须备份：`./data`（数据库 + `secret.key` + 自动生成的证书 + 管理员凭据）与 `./files`（附件）。

```bash
# 最稳妥：短暂停机后冷备份
docker compose stop openmail
tar czf openmail-backup-$(date +%F).tar.gz data files
docker compose start openmail
```

- 不想停机时，优先用管理后台的"下载 SQLite 备份"（`VACUUM INTO` 快照，一致性有保证），再单独 `rsync -a files/`；
  直接拷贝运行中的 `openmail.db` 有 WAL 一致性问题（`data/` 下还有 `-wal`、`-shm` 文件）。
- 恢复：停止容器 → 用备份覆盖 `data/` 与 `files/` → 启动容器。
- 定时备份示例（宿主机 crontab）：

  ```bash
  0 3 * * * rsync -a /opt/OpenMail/data/ /backup/openmail/data/ && rsync -a /opt/OpenMail/files/ /backup/openmail/files/
  ```

## 11. 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `manifest unknown` / `repository does not exist` | 镜像在该 registry 还没发布 | 用第 2 节源码构建；或在仓库 Actions 手动运行 `Docker Image` 工作流 |
| `pull access denied for chenyutech/openmail` | 目标镜像不存在/私有，或地址拼写错误 | Docker Hub 官方镜像为 Public；若拉取失败请核对地址，或改用 GHCR/源码构建 |
| `denied` / `unauthorized`（GHCR） | 包是 private 且未登录 | `docker login ghcr.io -u <github 用户名>`（PAT 勾选 `read:packages`），或把 package 设为 Public |
| 容器 `unhealthy` | 应用未起来 / 探针路由错误 / 端口不一致 | `docker compose logs -f`；确认容器内 3000 端口可用、`OM_HTTP_PORT` 与映射一致；探针必须是公开 `GET /` |
| `port is already allocated` | 宿主机端口被占用（25/143 常见于 Postfix/Dovecot） | `sudo ss -lntp \| grep ':25'` 找到并停掉冲突服务，或调整映射 |
| 写 `./data` 报 `permission denied` | 宿主机目录属主与容器运行用户不符 | 容器默认 root：`sudo chown -R 0:0 data files`；若自行指定了 `user:`，改成对该 uid 可写 |
| 拉取后无法在 arm64 上运行 | 只拿到 amd64 层 | 本项目发布多架构；确认 `docker pull --platform linux/arm64 ...`，旧标签可能只有 amd64，可本地构建 |
| `docker build` 在无外网/限制网络环境失败（`npm ci` 拉包超时） | 构建期需要访问 npm registry | 改用第 3 节预构建镜像；或给 Docker 配置 registry mirror / 代理后重试 |
| 浏览器访问 502/无法连接 | 反代指向错误或容器没起 | `docker compose ps`、`curl http://127.0.0.1:3000/`；容器内反代地址/服务名是否正确 |
| 收不到外网邮件 | 25 入站被云厂商封禁 / 安全组未放行 / MX 或 PTR 不对 | 检查安全组与 `dig MX`；25 入站被封只能更换 VPS 或使用邮件网关 |
| 发信进入对方垃圾箱 | SPF/DKIM/DMARC/PTR 未配好、出站 IP 信誉差 | 按 [DNS-Guide.md](DNS-Guide.md) 配齐记录，使用 mail-tester 自测；必要时改走中继 |

## 12. 相关文档

- 源码 / systemd / 手动部署、Nginx 与证书细节：[DEPLOYMENT.md](DEPLOYMENT.md)
- DNS / SPF / DKIM / DMARC 记录：[DNS-Guide.md](DNS-Guide.md)
- 项目说明与配置总表：[../README.zh-CN.md](../README.zh-CN.md) · [../README.md](../README.md)
- 环境变量示例：[../.env.example](../.env.example)
- Compose 文件：[../docker-compose.yml](../docker-compose.yml) · 镜像构建：[../Dockerfile](../Dockerfile) · 发布工作流：[../.github/workflows/docker-publish.yml](../.github/workflows/docker-publish.yml)
