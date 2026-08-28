# 部署指南 / Deployment Guide

从零把 OpenMail 部署到一台公网 VPS 的完整流程。以 **Ubuntu 22.04/24.04 + 域名 example.com** 为例。

## 1. 服务器准备

| 项 | 要求 |
| --- | --- |
| 系统 | Debian 12 / Ubuntu 22.04+（物理机、KVM 虚拟机均可；不支持无独立内核的容器型 VZ/LXC） |
| 配置 | 1 核 / 1 GB 内存 / 20 GB SSD 起（个人用）；团队建议 2 核 / 2–4 GB |
| 网络 | 固定公网 IPv4；**入站与出站 25 端口未被封禁**（国内云需工单解封或改用中继） |
| DNS | 先按 [DNS-Guide.md](DNS-Guide.md) 配好 A / MX / SPF / DKIM / DMARC / PTR |

```bash
# 安装 Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # v22.x 以上
```

## 2. 安装 OpenMail

```bash
sudo useradd -m -s /bin/bash openmail
sudo -iu openmail
git clone https://github.com/yourname/openmail.git ~/openmail && cd ~/openmail
npm install --omit=dev
```

创建 `.env`（关键项必须设置）：

```ini
OM_SITE_NAME=Example Mail
OM_PRIMARY_DOMAIN=example.com
OM_BASE_URL=https://mail.example.com
OM_ADMIN_EMAIL=admin@example.com
OM_SECRET=（openssl rand -hex 32 生成）
OM_SMTP_PORT=25
OM_SUBMISSION_PORT=587
OM_SMTPS_PORT=465
OM_IMAP_PORT=143
OM_IMAPS_PORT=993
OM_POP3_PORT=110
OM_POP3S_PORT=995
# 出站中继（云厂商封 25 出站时必配）
#OM_RELAY_HOST=smtp.sendgrid.net
#OM_RELAY_PORT=587
#OM_RELAY_USER=apikey
#OM_RELAY_PASS=SG.xxxx
```

## 3. TLS 证书（Let's Encrypt）

```bash
sudo apt-get install -y certbot
sudo certbot certonly --standalone -d mail.example.com
# 若 80 端口被占用可先用 --nginx 或临时停掉占用进程
```

> 取证书时先不要启动 OpenMail（80 端口要空闲）；或使用 DNS-01 验证。

在 `.env` 中指向证书：

```ini
OM_TLS_CERT=/etc/letsencrypt/live/mail.example.com/fullchain.pem
OM_TLS_KEY=/etc/letsencrypt/live/mail.example.com/privkey.pem
```

让 openmail 用户可读证书：

```bash
sudo setfacl -R -m u:openmail:rX /etc/letsencrypt/{live,archive}
# 续期后自动生效：加一个 deploy hook 重启服务即可（见第 4 节 systemd 配置）
```

> 也可以不用内置 TLS，由 Nginx/Caddy 反代 443 提供 Web TLS；但 **SMTP/IMAP/POP3 的 STARTTLS 与隐式 TLS 必须由 OpenMail 持证书**，所以邮件域名证书建议始终走上面配置。

## 4. systemd 服务

`sudo nano /etc/systemd/system/openmail.service`：

```ini
[Unit]
Description=OpenMail Server
After=network.target

[Service]
User=openmail
WorkingDirectory=/home/openmail/openmail
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
# 低于 1024 的特权端口需要能力（Node 以非 root 用户绑定 25/143/993…）
AmbientCapabilities=CAP_NET_BIND_SERVICE
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openmail
sudo journalctl -u openmail -f      # 首次启动查看管理员初始密码
```

证书自动续期 hook（`sudo nano /etc/letsencrypt/renewal-hooks/deploy/openmail.sh`）：

```bash
#!/bin/sh
systemctl restart openmail
```

```bash
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/openmail.sh
```

## 5. 防火墙

```bash
sudo ufw allow 22/tcp
sudo ufw allow 25,587,465/tcp     # SMTP
sudo ufw allow 143,993/tcp        # IMAP
sudo ufw allow 110,995/tcp        # POP3（不用 POP 可不开）
sudo ufw allow 80,443/tcp         # Webmail（80 供 certbot 续期）
sudo ufw enable
```

云厂商**安全组**同样要放行以上端口（入方向）；出方向放行 25/587。

## 6.（可选）Nginx 反代 Webmail

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
        client_max_body_size 30m;   # 附件上传
    }
}
```

之后 `.env` 里 `OM_HTTP_PORT=3000` 保持内网监听即可，公网只暴露 443。

## 7. Docker Compose 方式（替代 2–6 节）

```bash
git clone https://github.com/yourname/openmail.git && cd openmail
cp .env.example .env   # 编辑配置
docker compose up -d
```

端口映射、数据卷见 `docker-compose.yml`。证书可挂载到容器并配置 `OM_TLS_CERT/KEY`。

## 8. 上线后验证

```bash
# 1) 从 Gmail 给你发信，确认入站
# 2) 用 webmail 给 Gmail 发信，确认不被丢进垃圾箱
# 3) 客户端连接测试
openssl s_client -connect mail.example.com:993 -quiet    # IMAPS
openssl s_client -connect mail.example.com:587 -starttls smtp -quiet
# 4) DNS 全球生效检查
dig MX example.com +short
dig TXT example.com +short
dig TXT om1._domainkey.example.com +short
# 5) 评分
#    https://www.mail-tester.com  目标 ≥ 9/10
```

## 9. 备份与恢复

| 内容 | 位置 | 方式 |
| --- | --- | --- |
| 数据库 | `data/openmail.db` | 管理后台"下载备份"（VACUUM INTO 快照）或直接冷备 |
| 附件 | `files/` | rsync / 对象存储定时同步 |
| DKIM 私钥 | 数据库内 | 随数据库备份 |

crontab 示例（每日 3 点备份到 /backup）：

```bash
0 3 * * * sqlite3 /home/openmail/openmail/data/openmail.db ".backup /backup/openmail-$(date +\%F).db"
0 3 * * * rsync -a /home/openmail/openmail/files/ /backup/files/
```

恢复：停止服务 → 还原 `openmail.db` 与 `files/` → 启动。

## 10. 运维监控建议

- `journalctl -u openmail` 观察投递与认证日志；审计日志在管理后台可视化查看。
- 关注外发队列（管理后台 → 外发队列）：`failed` 条目说明出站链路（25 端口/中继凭据）有问题。
- IP 信誉：将 IP 加入 [Google Postmaster](https://postmaster.google.com/)、定期查 [MXToolbox 黑名单](https://mxtoolbox.com/blacklists.aspx)。
- 磁盘：邮件按 `OM_MAX_MAILBOX_MB` 配额增长，`du -sh files/` 定期检查。
- 时间同步：`timedatectl` 确保 NTP 生效（TOTP 与 TLS 都依赖准确时钟）。
