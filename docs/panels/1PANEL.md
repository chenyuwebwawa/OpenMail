# OpenMail × 1Panel 部署指南

[1Panel](https://1panel.cn/) 是新一代 Linux 服务器运维面板。本指南用 1Panel 完成 OpenMail 的部署、域名站点（OpenResty 反代）、SSL 与邮件端口放行。

> 1Panel 无「邮局」类插件，通常无端口冲突，OpenMail 可直接使用标准邮件端口（25/587/465/143/993/110/995）。

## 方式一：Docker Compose 部署（推荐）

1. **准备 .env**

   ```bash
   mkdir -p /opt/openmail && cd /opt/openmail
   git clone https://github.com/chenyuwebwawa/OpenMail.git app && cd app
   cp .env.example .env
   nano .env
   ```

   ```ini
   OM_PRIMARY_DOMAIN=example.com
   OM_BASE_URL=https://mail.example.com
   OM_ADMIN_EMAIL=admin@example.com
   OM_SECRET=<随机长字符串>
   OM_SMTP_PORT=25
   OM_SUBMISSION_PORT=587
   OM_SMTPS_PORT=465
   OM_IMAP_PORT=143
   OM_IMAPS_PORT=993
   OM_POP3_PORT=110
   OM_POP3S_PORT=995
   # 若云厂商封 25 出站，配置中继:
   # OM_RELAY_HOST=smtp.sendgrid.net
   # OM_RELAY_PORT=587
   # OM_RELAY_USER=apikey
   # OM_RELAY_PASS=xxx
   ```

2. **1Panel → 容器 → 编排 → 创建编排**
   - 路径选择 `/opt/openmail/app`（含 `docker-compose.yml` 的目录）
   - 名称 `openmail`，确定后启动
   - 或直接命令行：`cd /opt/openmail/app && docker compose up -d`

3. **安装语言包（10 语言界面）**

   ```bash
   docker exec openmail node scripts/install-langpacks.mjs --all
   ```

   > 镜像内已含 langpacks 目录，也可在管理后台网页一键安装。

## 方式二：主机进程部署

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chenyuwebwawa/OpenMail/main/install.sh) --standard-ports --domain example.com
```

脚本自动完成 Node 22、源码、.env、systemd 与语言包安装。

## 域名站点访问（网站反代）

1. **1Panel → 网站 → 创建网站 → 反向代理**
   - 主域名：`mail.example.com`（先去 DNS 加 A 记录指向服务器 IP）
   - 代理地址：`http://127.0.0.1:3000`
2. **网站设置 → 反向代理**，编辑生成的配置，确保包含：

   ```nginx
   client_max_body_size 30m;
   proxy_set_header Host $host;
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   ```

3. **HTTPS 证书**：网站设置 → HTTPS → 申请 Let's Encrypt 证书（ACME 账户在 1Panel「网站 → 证书」中配置）→ 勾选「强制 HTTPS」。
4. **把证书交给 OpenMail 用于邮件 TLS**：1Panel 证书目录一般在
   `/opt/1panel/apps/openresty/openresty/www/sites/mail.example.com/ssl/`（以实际为准，证书页可看路径）。
   在 `.env` 配置：

   ```ini
   OM_TLS_CERT=/opt/1panel/.../ssl/fullchain.pem
   OM_TLS_KEY=/opt/1panel/.../ssl/privkey.pem
   ```

   Docker 部署时把证书目录挂载进容器（compose 中加：

   ```yaml
   volumes:
     - /opt/1panel/.../ssl:/certs:ro
   environment:
     OM_TLS_CERT: /certs/fullchain.pem
     OM_TLS_KEY: /certs/privkey.pem
   ```

   ）→ `docker compose up -d` 或 `systemctl restart openmail` 生效。

5. **防火墙**：1Panel → 主机 → 防火墙，放行 `25,587,465,143,993,110,995/tcp` 与 `80,443`；`3000` 可不放行公网（走反代）。云服务商安全组同步放行。

## 邮件 DNS（与通用指南一致）

在 DNS 服务商添加（OpenMail 管理后台 → 域名管理 → DNS 配置 可逐条复制）：

| 类型 | 主机 | 值 |
| --- | --- | --- |
| A | mail | 服务器 IP |
| MX | @ | mail.example.com (10) |
| TXT | @ | `v=spf1 mx ip4:<服务器IP> ~all` |
| TXT | om1._domainkey | 管理后台提供的 DKIM 公钥 |
| TXT | _dmarc | `v=DMARC1; p=none; rua=mailto:admin@example.com` |

## 验证

```bash
docker exec -it openmail sh -c 'wget -qO- http://127.0.0.1:3000/api/langs'   # 应返回 10 种语言
openssl s_client -connect mail.example.com:993 -quiet                        # IMAPS TLS 握手
dig MX example.com +short                                                    # 全球生效
```

浏览器打开 `https://mail.example.com` → 登录 → **设置 → 语言** 切换界面语言 → 管理后台创建域名/邮箱 → 收发测试。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 容器日志 `EADDRINUSE :25` | 主机已有 MTA（postfix/exim）：`systemctl disable --now postfix exim4` 后重启编排 |
| 收不到外部来信 | 安全组/防火墙入方向 25 未放行；或域名 MX 未生效（`dig MX`） |
| 外发全进垃圾箱 | 按 DNS 表补齐 SPF/DKIM/DMARC；PTR 反解；观察一周后收紧 ~all → -all |
| 反代 502 | `docker ps` 确认容器 Up；代理地址端口与 `OM_HTTP_PORT` 一致 |
