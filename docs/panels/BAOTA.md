# OpenMail × 宝塔面板部署指南（含宝塔邮局适配）

本指南覆盖在**已安装宝塔面板（aaPanel 同理）**的服务器上部署 OpenMail，并完成域名网站访问、SSL、邮件端口与「宝塔邮局」插件的适配。

## 〇、三种部署形态

| 形态 | 说明 | 适合 |
| --- | --- | --- |
| **A. OpenMail 替代宝塔邮局**（推荐） | 停用宝塔「邮局」插件，OpenMail 独占 25/587/143… 标准端口 | 从零建站，或想换掉 Postfix+Dovecot 方案 |
| **B. 与宝塔邮局共存** | 宝塔邮局继续跑，OpenMail 用开发端口 + 反代提供 Webmail/管理 | 已有宝塔邮局在跑、暂不迁移 |
| **C. 宝塔仅作 Web 面板** | 服务器无宝塔邮局，OpenMail 直接标准端口部署 | 大多数新建服务器 |

> **重要**：OpenMail 与宝塔邮局都是完整邮件服务器（都占用 25 端口），**不要同时运行**。方案 B 仅用于过渡。

## 一、快速部署（自动适配）

SSH 登录服务器，root 执行：

```bash
# 方案 A / C：停用宝塔邮局后按标准端口安装
bash <(curl -fsSL https://raw.githubusercontent.com/chenyuwebbawa/OpenMail/main/scripts/baota-adapt.sh)

# 方案 B：保留宝塔邮局，OpenMail 用开发端口
bash <(curl -fsSL https://raw.githubusercontent.com/chenyuwebbawa/OpenMail/main/scripts/baota-adapt.sh) --keep-mailbox
```

适配脚本会：检测端口冲突 → 按需停用 postfix/dovecot → 安装 OpenMail（Node 22 + systemd）→ 写入正确端口 → 打印宝塔站点配置参数。

<details>
<summary>手动部署（不跑脚本）</summary>

```bash
# 安装 Node 22（宝塔「软件商店 → Node.js 版本管理器」亦可，注意选择 22+ 并记录 node 路径）
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs

git clone https://github.com/chenyuwebbawa/OpenMail.git /opt/openmail
cd /opt/openmail && npm install --omit=dev
cp .env.example .env && nano .env   # 见下方「.env 关键项」
npm run langpacks                    # 或 node scripts/install-langpacks.mjs --all 安装语言包
```

systemd 服务 `/etc/systemd/system/openmail.service`：

```ini
[Unit]
Description=OpenMail Server
After=network.target
[Service]
User=www
WorkingDirectory=/opt/openmail
ExecStart=/usr/bin/node server/index.js
Restart=always
AmbientCapabilities=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now openmail
```
</details>

## 二、.env 关键项（宝塔环境）

```ini
OM_SITE_NAME=OpenMail
OM_PRIMARY_DOMAIN=example.com              # 你的邮件域名
OM_BASE_URL=https://mail.example.com       # 对外站点地址
OM_ADMIN_EMAIL=admin@example.com
OM_SECRET=<随机长字符串>

# 邮件端口：方案 A/C 用标准端口；方案 B 用 2525/2587/2546/1143/1993/1110/1995
OM_SMTP_PORT=25
OM_SUBMISSION_PORT=587
OM_IMAP_PORT=143
OM_IMAPS_PORT=993

# SSL：直接复用宝塔申请的证书
OM_TLS_CERT=/www/server/panel/vhost/cert/mail.example.com/fullchain.pem
OM_TLS_KEY=/www/server/panel/vhost/cert/mail.example.com/privkey.pem
```

改完执行 `systemctl restart openmail`。

## 三、宝塔配置域名网站访问（Webmail 站点）

1. **域名解析**：在 DNS 服务商添加
   - `mail.example.com` A 记录 → 服务器公网 IP
   - `example.com` MX → `mail.example.com`（优先级 10）
   - SPF / DKIM / DMARC：OpenMail 管理后台 → 域名管理 → **DNS 配置**，逐条复制添加

2. **宝塔 → 网站 → 添加站点**
   - 域名：`mail.example.com`
   - 不创建数据库、不创建 FTP、PHP 版本随意（纯静态即可）

3. **设置 → 反向代理 → 添加反向代理**
   - 代理名称：`openmail`
   - 目标 URL：`http://127.0.0.1:3000`（OpenMail 的 `OM_HTTP_PORT`）
   - 发送域名：`$host`
   - 开启反向代理后，进「配置文件」确认包含 `client_max_body_size 30m;`（附件上传），没有则补上：
     ```nginx
     location / {
         proxy_pass http://127.0.0.1:3000;
         proxy_set_header Host $host;
         proxy_set_header X-Real-IP $remote_addr;
         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
         client_max_body_size 30m;
     }
     ```

4. **SSL 证书**
   - 站点 → SSL → Let's Encrypt → 勾选 `mail.example.com` → 申请 → 开启「强制 HTTPS」
   - 把签发的证书路径填到 OpenMail 的 `.env`（见上文 `OM_TLS_CERT/KEY`），`systemctl restart openmail`
   - 这样 SMTP STARTTLS / IMAPS / SMTPS 也用上了有效证书（客户端不再报证书告警）

5. **宝塔 → 安全**：放行 `3000` 仅可限本机（反代走 127.0.0.1，可不放行公网）；放行邮件端口 `25,587,465,143,993,110,995`（方案 B 为 2525 等开发端口）。**云服务商安全组**同样要放行。

6. 访问 `https://mail.example.com` 即为 Webmail / 管理后台。

## 四、宝塔邮局（mail_sys 插件）适配说明

宝塔「邮局」插件 = Postfix(SMTP) + Dovecot(IMAP/POP3) + Roundcube，与 OpenMail 是**同一层的替代关系**：

| 对比 | 宝塔邮局 | OpenMail |
| --- | --- | --- |
| 架构 | 多进程（Postfix+Dovecot+MySQL） | 单进程 Node.js + SQLite |
| Webmail | Roundcube | 内置三栏 Webmail + 管理后台 |
| DKIM | 需插件/手动 | 每域名自动生成，DNS 记录一键复制 |
| 反垃圾 | 需自行加装 | 内置 SPF/DKIM/DMARC 认证 + 评分 |
| 账户体系 | 独立邮箱账户 | 完整用户体系：2FA/RBAC/审计/配额 |

**从宝塔邮局迁移到 OpenMail：**

1. 备份宝塔邮局数据（插件面板可导出；邮件本体在 `/home/wwwroot/mail` 或 vmail 目录）。
2. 邮件正文迁移（可选）：可用 IMAP 迁移工具（如 `imapsync`）把旧账户新邮件同步进 OpenMail（OpenMail 的 IMAP 端口在方案 A 下是 143/993）：
   ```bash
   imapsync --host1 127.0.0.1 --user1 old@example.com --password1 '***' \
            --host2 127.0.0.1 --port2 143 --user2 new@example.com --password2 '***'
   ```
3. 停用宝塔邮局插件（面板 → 软件商店 → 邮局 → 停止/卸载；或适配脚本已自动停用 postfix/dovecot）。
4. 在 OpenMail 管理后台重建域名与邮箱账号，DNS 记录保持不变（MX 已指向本机）。
5. 迁移后发一封测试信到 Gmail 验证送达，并用 mail-tester.com 打分。

## 五、常见问题

| 现象 | 处理 |
| --- | --- |
| OpenMail 起不来，日志报 `EADDRINUSE :25` | 宝塔邮局还在跑：面板停用邮局插件，或 `systemctl stop postfix dovecot` |
| 反代后登录 502 | `systemctl status openmail` 查看服务是否存活；确认反代目标端口与 `OM_HTTP_PORT` 一致 |
| 上传附件 413 | 站点反代配置补 `client_max_body_size 30m;` |
| 宝塔防火墙已放行仍收不到信 | 检查**云服务商安全组**（入方向 25）；国内云出站 25 被封 → 配 `OM_RELAY_*` 中继 |
| Webmail 时间不对 | 面板 → 计划任务校准时间，`timedatectl set-timezone Asia/Shanghai` |
| 多语言界面 | 部署脚本已装全部语言包；手动部署执行 `node scripts/install-langpacks.mjs --all` |
