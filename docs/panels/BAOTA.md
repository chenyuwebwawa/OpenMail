# OpenMail × 宝塔面板 完整部署教程（手把手版）

> 适用：宝塔面板 7.x / 8.x / 9.x（Linux），aaPanel 同理。
> 目标读者：只用过宝塔、不熟悉命令行也能跟着做完。
> 全程约 15–25 分钟。遇到报错直接翻 [第九节 排查速查表](#九常见问题排查速查表)。

---

## 目录

0. [三种部署形态（先看这个）](#〇三种部署形态先看这个)
1. [准备工作：检查服务器与域名](#一准备工作检查服务器与域名)
2. [处理宝塔邮局端口冲突](#二处理宝塔邮局端口冲突)
3. [安装 OpenMail（脚本自动版）](#三安装-openmail脚本自动版)
4. [安装 OpenMail（面板手动版）](#四安装-openmail面板手动版)
5. [宝塔放行端口](#五宝塔放行端口)
6. [建站 + 反向代理（Webmail 网站访问）](#六建站--反向代理webmail-网站访问)
7. [SSL 证书申请与回填](#七ssl-证书申请与回填)
8. [DNS 配置（让它能收发互联网邮件）](#八dns-配置让它能收发互联网邮件)
9. [常见问题排查速查表](#九常见问题排查速查表)
10. [安装后验证清单](#十安装后验证清单)
11. [邮件客户端（Thunderbird/手机）连接参数](#十一邮件客户端连接参数)
12. [升级 / 备份 / 卸载](#十二升级--备份--卸载)

---

## 〇、三种部署形态（先看这个）

| 形态 | 说明 | 选它的情况 |
| --- | --- | --- |
| **A. OpenMail 接管邮件**（推荐） | 停用宝塔「邮局」插件，OpenMail 独占 25/587/465/143/993/110/995 | 新服务器；或想从宝塔邮局换成 OpenMail |
| **B. 与宝塔邮局共存** | 宝塔邮局继续跑，OpenMail 用 2525 等高位端口，仅反代出 Webmail | 宝塔邮局里已有在用的邮箱、暂时不能迁移 → **[专项教程 BAOTA-COEXIST.md](BAOTA-COEXIST.md)** |
| **C. 无邮局插件** | 服务器没装过宝塔邮局，OpenMail 直接用标准端口 | 大多数新装宝塔的服务器（最常见） |

> ⚠️ **宝塔邮局插件 = Postfix + Dovecot + Roundcube**，和 OpenMail 是同类产品，都占 25 端口。**同一台机器二选一**，不要同时开。

---

## 一、准备工作：检查服务器与域名

### 1.1 服务器要求

| 项 | 最低 | 推荐 |
| --- | --- | --- |
| 系统 | CentOS 7.9+ / Ubuntu 20.04+ / Debian 11+ | Ubuntu 22.04 或 Debian 12 |
| 配置 | 1 核 1GB | 2 核 2GB |
| 宝塔 | 7.9 以上任意版本 | 8.x / 9.x |
| 磁盘剩余 | 2GB | 10GB+ |

### 1.2 云厂商安全组（最容易漏的一步！）

宝塔的「防火墙」和**云服务商的安全组**是两道独立的门，两边都要开。

以阿里云为例：**ECS 控制台 → 实例 → 安全组 → 配置规则 → 入方向 → 手动添加**：

| 方向 | 端口 | 用途 |
| --- | --- | --- |
| 入 | 25 | 收外部来信（MX） |
| 入 | 587、465 | 用户发信 |
| 入 | 143、993 | IMAP 收信 |
| 入 | 110、995 | POP3（不用可不开） |
| 入 | 80、443 | Webmail 网站 |
| 出 | 25、587 | 给外部发信（部分云默认放行，部分要手动加） |

> 🇨🇳 **国内云（阿里/腾讯/华为）默认封禁出站 25 端口**：申请解封成功率低，通用做法是在 `.env` 里配置 `OM_RELAY_*` 走中继发信（见 7.4 节），入站 25 不受影响。
> 海外 VPS（搬瓦工/Vultr/DMIT 等）一般不封。

### 1.3 域名解析（先加 2 条，后面 SSL 要用）

去你的 DNS 服务商（Cloudflare/阿里云解析/DNSPod…）添加：

| 类型 | 主机记录 | 记录值 | 说明 |
| --- | --- | --- | --- |
| A | `mail` | 你服务器的公网 IP | Webmail 站点 + 邮件主机名 |
| MX | `@` | `mail.你的域名.com`（优先级 10） | 让全世界的邮件发到你这 |

> SPF / DKIM / DMARC 三条 TXT 记录在第七节装完后从管理后台一键复制，先不用加。
> 如果 DNS 开了 Cloudflare 小云朵（CDN 代理），**mail 这条 A 记录要设为「仅 DNS」灰色云朵**——邮件流量不能走 CDN。

---

## 二、处理宝塔邮局端口冲突

### 2.1 先检查有没有装宝塔邮局

**宝塔面板 → 软件商店 → 已安装**，找「**邮局**」（mail_sys）：

- **没装** → 什么也不用做，你是形态 C，直接跳到第三节。
- **装了且在用** → 决定形态 A（停用接管）还是 B（共存）。
- **装了但没用过** → 建议直接卸载（软件商店 → 邮局 → 卸载），按形态 A 走。

### 2.2 形态 A：停用宝塔邮局（OpenMail 接管）

1. **宝塔面板 → 软件商店 → 已安装 → 邮局 → 停止**，再点 **卸载**（数据不重要的话）。
2. SSH 登录服务器（宝塔面板 → 终端，或用 PuTTY），确认端口已释放：

```bash
ss -ltnp | grep -E ':(25|587|465|143|993|110|995)\s'
# 没有任何输出 = 端口已释放，可以继续
```

3. 如果还有残留进程（宝塔邮局卸载有时不干净）：

```bash
systemctl stop postfix dovecot 2>/dev/null
systemctl disable postfix dovecot 2>/dev/null
ss -ltnp | grep -E ':(25|143|993)\s'   # 再确认一次
```

### 2.3 形态 B：共存（OpenMail 用高位端口）

什么都不用停。后面安装时端口填开发端口，并在宝塔放行这些高位端口：

`2525（MX）、2587（发信）、2546（SMTPS）、1143/1993（IMAP）、1110/1995（POP3）`

> 注意：形态 B 下 OpenMail 收不到互联网来的邮件（真实 MX 在宝塔邮局手里），只能站内互发 + 通过宝塔邮局的中继。它适合「先试用 Webmail，再决定迁移」。
>
> 📖 **共存模式有独立的手把手专项教程：[BAOTA-COEXIST.md](BAOTA-COEXIST.md)** —— 包含端口分配表、外发借道 Postfix 中继的两种做法、以及用子域名（`@om.example.com`）打通收信的进阶方案，让老邮箱和新邮箱真正并行。

---

## 三、安装 OpenMail（脚本自动版，推荐）

SSH 到服务器，**root** 执行一行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chenyuwebwawa/OpenMail/main/scripts/baota-adapt.sh)
```

> 🇨🇳 **国内网络报 404 / 超时？** 部分国内服务器访问 `raw.githubusercontent.com` 会被污染或缓存 404。任选一种替代：
>
> ```bash
> # ① jsDelivr 国内友好镜像（推荐）
> bash <(curl -fsSL https://cdn.jsdelivr.net/gh/chenyuwebwawa/OpenMail@main/scripts/baota-adapt.sh)
>
> # ② git clone 后用本地脚本（github.com 主站一般可达）
> git clone https://github.com/chenyuwebwawa/OpenMail.git /opt/openmail
> cd /opt/openmail && bash scripts/baota-adapt.sh --standard-ports
> ```
>
> 新版适配脚本已内置三级回退：raw → jsDelivr 镜像 → git clone，优先使用同仓库本地脚本。

脚本会自动：检测端口冲突 →（形态 A）停用残留 MTA → 安装 Node 22 → 克隆源码到 `/opt/openmail` → `npm install` → 生成 `.env` → 注册 systemd 服务 → 安装全部 10 种界面语言包 → 最后打印**管理员账号密码**和下一步操作清单。

想要交互少一点，可以带参数直接跑：

```bash
# 形态 A/C（标准端口）+ 指定域名：
bash <(curl -fsSL https://raw.githubusercontent.com/chenyuwebwawa/OpenMail/main/scripts/baota-adapt.sh) --domain example.com --standard-ports

# 形态 B（不动宝塔邮局，用高位端口）：
bash <(curl -fsSL https://raw.githubusercontent.com/chenyuwebwawa/OpenMail/main/scripts/baota-adapt.sh) --keep-mailbox
```

装完先验证服务活着：

```bash
systemctl status openmail        # Active: active (running) 即正常
curl -s http://127.0.0.1:3000/ -o /dev/null -w "%{http_code}\n"   # 输出 200
```

浏览器先访问 `http://服务器IP:3000` 能看到官网首页（第 5 节放行后），管理员密码在：

```bash
cat /opt/openmail/data/admin-credentials.txt
```

> ✅ 到这里 OpenMail 本体已经装完。接下来是宝塔面板里的图形化操作。

---

## 四、安装 OpenMail（面板手动版）

不想跑一键脚本的话，全程可以用宝塔的图形界面完成。

### 4.1 安装 Node.js（宝塔 Node 版本管理器）

1. **宝塔面板 → 软件商店** → 搜索「**Node.js**」→ 安装「**Node.js 版本管理器**」。
2. 打开该插件 → **安装版本** → 选 **v22.x**（必须 ≥ 22.5）→ 等待安装完成。
3. 记下 node 的实际路径，一般是：
   ```
   /www/server/nodejs/v22.x.x/bin/node
   ```
   （可在插件「版本管理」里看到；后面 systemd 要用。）

### 4.2 下载源码

**宝塔面板 → 终端**（左侧黑色图标），执行：

```bash
mkdir -p /opt/openmail && cd /opt/openmail
git clone https://github.com/chenyuwebwawa/OpenMail.git app && cd app
/www/server/nodejs/v22.x.x/bin/npm install --omit=dev --no-audit --no-fund
```

> 没有 git？软件商店装一个「Git」，或 `yum install -y git` / `apt install -y git`。

### 4.3 写配置文件

```bash
cd /opt/openmail/app
cp .env.example .env
vi .env        # 或用宝塔「文件」管理器导航到 /opt/openmail/app 双击编辑
```

必改的行（其余默认）：

```ini
OM_SITE_NAME=我的邮箱
OM_PRIMARY_DOMAIN=example.com              # 你的邮件域名
OM_BASE_URL=https://mail.example.com       # 对外访问地址
OM_ADMIN_EMAIL=admin@example.com           # 初始管理员
OM_SECRET=一串随机长字符串                  # openssl rand -hex 32 生成
OM_HTTP_PORT=3000

# 形态 A/C 用标准端口（.env.example 默认就是），形态 B 改成：
# OM_SMTP_PORT=2525  OM_SUBMISSION_PORT=2587  OM_SMTPS_PORT=2546
# OM_IMAP_PORT=1143  OM_IMAPS_PORT=1993  OM_POP3_PORT=1110  OM_POP3S_PORT=1995
```

### 4.4 注册系统服务（开机自启）

```bash
cat > /etc/systemd/system/openmail.service <<'EOF'
[Unit]
Description=OpenMail Server
After=network.target

[Service]
User=www
WorkingDirectory=/opt/openmail/app
ExecStart=/www/server/nodejs/v22.x.x/bin/node server/index.js
Restart=always
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now openmail
systemctl status openmail     # 看到 active (running) 即成功
```

> `User=www` 是宝塔默认的运行用户；`AmbientCapabilities` 让非 root 用户也能绑 25/143 等特权端口。
> 初始管理员密码：`cat /opt/openmail/app/data/admin-credentials.txt`

### 4.5 安装界面语言包（可选，10 种语言）

```bash
cd /opt/openmail/app && /www/server/nodejs/v22.x.x/bin/node scripts/install-langpacks.mjs --all
```

---

## 五、宝塔放行端口

**宝塔面板 → 主机安全（或「安全」）→ 防火墙 → 添加端口规则**，逐条添加：

| 端口 | 协议 | 备注 |
| --- | --- | --- |
| 3000 | TCP | OpenMail HTTP（**仅临时**，建好反代后可删除） |
| 25 / 587 / 465 | TCP | SMTP 三件套（形态 B 用 2525/2587/2546） |
| 143 / 993 | TCP | IMAP（形态 B 用 1143/1993） |
| 110 / 995 | TCP | POP3（形态 B 用 1110/1995） |
| 80 / 443 | TCP | 网站与证书签发 |

> 别忘了 **1.2 节的云安全组**。两道门都开才算通。
> 建好反向代理后，把 3000 那条规则删掉，公网就摸不到源站端口了。

---

## 六、建站 + 反向代理（Webmail 网站访问）

这一步做完，就能用 `https://mail.你的域名.com` 打开邮箱了。

### 6.1 添加站点

1. **宝塔面板 → 网站 → HTML 项目（或“静态站点”）→ 添加站点**
2. 填写：
   - **域名**：`mail.example.com`（第一节的 A 记录解析的那个）
   - 根目录：默认即可（不会真的用到文件）
   - PHP 版本：**纯静态**
   - 不创建数据库、不创建 FTP
3. 提交。

### 6.2 配置反向代理

1. 点该站点 → **反向代理 → 添加反向代理**
2. 填写：
   - 代理名称：`openmail`
   - 目标 URL：`http://127.0.0.1:3000`
   - 发送域名：`$host`
3. 保存后，再点该代理的 **配置文件**，确认/补齐成下面这样（重点是两行 header 和 body 限制）：

```nginx
location /
{
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header REMOTE-HOST $remote_addr;
    proxy_http_version 1.1;
    client_max_body_size 30m;      # 附件上传上限，小于 OpenMail 的 25MB 会被 413
}
```

4. 保存 → 浏览器访问 `http://mail.example.com` 应该能看到 OpenMail 官网首页。

> 💡 如果 502：先 `systemctl status openmail` 确认服务活着，再确认目标 URL 端口和 `.env` 里 `OM_HTTP_PORT` 一致。

### 6.3 （可选）站点加固

站点 → **配置文件**，在 `server { }` 里追加：

```nginx
# 屏蔽直接用 IP 访问源站（可选）
if ($host !~* ^(mail\.example\.com)$) { return 444; }
```

---

## 七、SSL 证书申请与回填

OpenMail 有**两处**需要证书，用同一张 Let's Encrypt 证书即可：

1. **Webmail 网站 HTTPS**（宝塔站点证书）；
2. **邮件协议 TLS**（SMTP STARTTLS / IMAPS / POP3S / SMTPS —— OpenMail 自己持有）。

### 7.1 宝塔申请证书

1. 站点 → **SSL** → 选 **Let's Encrypt** → 勾选 `mail.example.com` → **申请**。
2. 成功后打开 **强制 HTTPS** 开关。
3. 记下证书文件路径（点「证书夹」或直接看文件）：
   ```
   /www/server/panel/vhost/cert/mail.example.com/fullchain.pem
   /www/server/panel/vhost/cert/mail.example.com/privkey.pem
   ```
   （不同宝塔版本路径可能是 `/www/server/panel/data/ssl/...`，以面板显示为准。）

### 7.2 把证书回填给 OpenMail（邮件 TLS 用）

```bash
# 让 openmail 运行用户能读证书
chmod -R o+rx /www/server/panel/vhost/cert/mail.example.com

# 编辑 .env，追加/修改两行（路径按上一步实际为准）
vi /opt/openmail/app/.env
```

```ini
OM_TLS_CERT=/www/server/panel/vhost/cert/mail.example.com/fullchain.pem
OM_TLS_KEY=/www/server/panel/vhost/cert/mail.example.com/privkey.pem
```

```bash
systemctl restart openmail
```

验证邮件 TLS 生效（看到证书主题 `CN=mail.example.com` 即成功）：

```bash
openssl s_client -connect mail.example.com:993 -quiet < /dev/null | head -3
```

### 7.3 证书续期自动生效

Let's Encrypt 三个月一续，宝塔会自动续期站点证书，但 **OpenMail 需要重启才加载新证书**。加一个自动 hook（一次性操作）：

```bash
cat > /www/server/panel/script/renew_openmail_ssl.sh <<'EOF'
#!/bin/bash
systemctl restart openmail
EOF
chmod +x /www/server/panel/script/renew_openmail_ssl.sh

# 宝塔 → 计划任务 → 添加任务：
#   任务类型: Shell 脚本 | 任务名称: 证书续期后重启OpenMail | 周期: 每天 凌晨 3:30
#   脚本内容: 检测证书文件变更时间，若 1 天内变过则重启
cat > /opt/openmail/check-cert-renew.sh <<'EOF'
#!/bin/bash
CERT=/www/server/panel/vhost/cert/mail.example.com/fullchain.pem
MARK=/opt/openmail/.cert-mtime
[ -z "$(find "$CERT" -newer "$MARK" 2>/dev/null)" ] || { systemctl restart openmail; touch "$MARK"; }
EOF
chmod +x /opt/openmail/check-cert-renew.sh && touch /opt/openmail/.cert-mtime
# 计划任务的脚本内容填: bash /opt/openmail/check-cert-renew.sh
```

### 7.4 （国内云必看）出站 25 被封？配置发信中继

编辑 `/opt/openmail/app/.env`：

```ini
OM_RELAY_HOST=smtp.exmail.qq.com     # 换成你的中继服务商
OM_RELAY_PORT=587
OM_RELAY_SECURE=false
OM_RELAY_USER=你的账号
OM_RELAY_PASS=你的密码或APIKey
```

常用中继：腾讯企业邮 SMTP、阿里云邮件推送（DirectMail）、SendGrid（`smtp.sendgrid.net`，用户名填 `apikey`，密码填 API Key）、Mailgun。改完 `systemctl restart openmail`。

---

## 八、DNS 配置（让它能收发互联网邮件）

**宝塔面板 → 网站 → OpenMail 管理后台**（`https://mail.example.com/app` → 管理员登录）：

1. **管理后台 → 域名管理 → 添加域名**：填 `example.com` → 系统自动生成 DKIM 密钥对。
2. 点该域名的 **DNS 配置** → 服务器公网 IP 填你的 IP → 得到 6 条记录，**逐条复制**到你的 DNS 服务商：

| 类型 | 主机记录 | 记录值（示例） |
| --- | --- | --- |
| A | `mail` | `203.0.113.10`（第一节已加，核对即可） |
| MX | `@` | `mail.example.com`（优先级 10，已加） |
| TXT (SPF) | `@` | `v=spf1 mx ip4:203.0.113.10 ~all` |
| TXT (DKIM) | `om1._domainkey` | 后台给出的长串公钥 |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:admin@example.com` |
| PTR | —— | 在**云服务商控制台**（不是 DNS）把 IP 反解到 `mail.example.com` |

3. 回到后台 → **域名管理 → Catch-all**：可把所有发往不存在地址的信收进某个邮箱（可选）。

> SPF 用 `~all` 观察一周，送达稳定后改成 `-all`；DMARC 从 `p=none` 起步。详细原理见 [DNS-Guide.md](../DNS-Guide.md)。

---

## 九、常见问题排查速查表

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 网站 502 Bad Gateway | OpenMail 没起来 / 端口不对 | `systemctl status openmail`；核对反代目标端口 = `OM_HTTP_PORT` |
| 网站一直转圈超时 | 宝塔防火墙或云安全组没放行 3000（临时直连测试时） | 第五节两条都检查；或直接走域名反代 |
| 上传附件报 413 | 反代没设 body 限制 | 6.2 节配置加 `client_max_body_size 30m;` |
| `EADDRINUSE :25` 起不来 | 宝塔邮局/Postfix 还在跑 | 第二节 2.2 停干净：`systemctl stop postfix dovecot && systemctl disable postfix dovecot` |
| 收不到外部来信 | ① 云安全组没放行入 25 ② MX 记录没生效 | `dig MX example.com +short` 验证；安全组逐条核对 |
| 发出去进对方垃圾箱 | SPF/DKIM/DMARC 没配齐 / 新 IP 信誉空白 | 第八节补齐记录；[mail-tester.com](https://www.mail-tester.com) 打分 ≥ 9 |
| 外发全部失败（队列 failed） | 出站 25 被云封 / 中继凭据错误 | 7.4 配置中继；后台「外发队列」看错误详情 |
| Thunderbird 报证书不受信任 | 没做 7.2 证书回填，还是自签证书 | 完成第七节 |
| Webmail 时间差 8 小时 | 服务器时区 | `timedatectl set-timezone Asia/Shanghai` |
| 登录提示会话过期（刚登录） | 服务器时间不准（影响 TLS/TOTP） | 同上，校时并确认 NTP 开启 |
| 界面不是中文 | 语言包没装 | `cd /opt/openmail/app && node scripts/install-langpacks.mjs --all` |
| 想重置管理员密码 | —— | `node server/setup.js reset-admin admin@example.com 新密码` |

---

## 十、安装后验证清单

依次打勾：

- [ ] 浏览器 `https://mail.example.com` 打开官网 → 点「进入邮箱」能登录
- [ ] 站内互发：注册两个账号（或后台建）互发一封，收件箱即时可见
- [ ] 附件：写信加一个附件发送，收件方能下载
- [ ] 外部收信：用 QQ/Gmail 给 `admin@example.com` 发一封 → 收件箱出现
- [ ] 外部发信：给 QQ/Gmail 发一封 → 对方收到（不在垃圾箱为佳）
- [ ] 客户端：按第十一节参数在 Thunderbird/手机邮件 App 添加账户成功
- [ ] TLS：`openssl s_client -connect mail.example.com:993` 显示有效证书
- [ ] 后台：仪表盘有图表、外发队列无 failed、审计日志在滚动

---

## 十一、邮件客户端连接参数

给用户分发邮箱时，直接把这张表发给他们：

| 参数 | 值 |
| --- | --- |
| 收件服务器（IMAP） | `mail.example.com` · 端口 **993** · SSL/TLS |
| 收件服务器（POP3，可选） | `mail.example.com` · 端口 **995** · SSL/TLS |
| 发件服务器（SMTP） | `mail.example.com` · 端口 **587** · STARTTLS · **需认证** |
| 用户名 | 完整邮箱地址 `user@example.com` |
| 密码 | 该邮箱的密码（管理员后台创建时设置/生成的那个） |

> 形态 B（高位端口共存）时客户端端口对应替换：IMAP **1143** · IMAPS **1993** · POP3 **1110** · POP3S **1995** · SMTP Submission **2587** · SMTPS **2546**。
> 网页版直接访问 `https://mail.example.com/app`，功能最全（AI 助手、模板、通讯录）。

---

## 十二、升级 / 备份 / 卸载

### 升级 OpenMail

```bash
cd /opt/openmail/app
git pull
npm install --omit=dev          # 有依赖变更时需要
systemctl restart openmail
```

### 备份（宝塔计划任务版）

需要备份的东西只有两样：数据库 + 附件目录。

1. **宝塔 → 计划任务 → 添加任务**
   - 类型：Shell 脚本；周期：每天 凌晨 3:00
   - 脚本内容：

```bash
BAK=/www/backup/openmail
mkdir -p $BAK
# 数据库一致性快照
sqlite3 /opt/openmail/app/data/openmail.db ".backup $BAK/openmail-$(date +%F).db"
# 附件目录
rsync -a --delete /opt/openmail/app/files/ $BAK/files/
# 保留最近 14 天
find $BAK -name "openmail-*.db" -mtime +14 -delete
```

> 没有 sqlite3 命令就 `apt install -y sqlite3` / `yum install -y sqlite`；或者用 OpenMail 后台「系统设置 → 下载数据库备份」手动下载。

2. 再加一条宝塔自带的「备份数据库/目录到云存储」任务把 `/www/backup/openmail` 同步到 OSS/S3（可选）。

### 恢复

```bash
systemctl stop openmail
cp /path/to/backup.db /opt/openmail/app/data/openmail.db
rm -f /opt/openmail/app/data/openmail.db-wal /opt/openmail/app/data/openmail.db-shm
rsync -a /path/to/backup/files/ /opt/openmail/app/files/
systemctl start openmail
```

### 卸载 OpenMail

```bash
systemctl disable --now openmail
rm -f /etc/systemd/system/openmail.service && systemctl daemon-reload
rm -rf /opt/openmail          # 数据也在这里，确认不要了再删
```

宝塔站点和反代在面板里删除即可。

---

## 附：从宝塔邮局迁移到 OpenMail

1. 宝塔邮局面板导出/记录现有邮箱账户列表；
2. 邮件内容迁移（可选，用 imapsync 从旧 Dovecot 拉进 OpenMail 的 IMAP）：

```bash
apt install -y imapsync   # 或 cpan 安装
imapsync --host1 127.0.0.1 --port1 143 --user1 old@example.com --password1 '旧密码' \
         --host2 127.0.0.1 --port2 143 --user2 new@example.com --password2 '新密码'
```

3. 停用宝塔邮局（第二节），OpenMail 切标准端口；
4. OpenMail 后台重建域名与账户，DNS 记录不变（MX 已指向本机）；
5. 用 [mail-tester.com](https://www.mail-tester.com) 验证送达评分。
