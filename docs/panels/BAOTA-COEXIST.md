# OpenMail 与宝塔邮局共存部署教程（形态 B 手把手版）

> 场景：服务器上**已经装着宝塔「邮局」插件**（Postfix + Dovecot + Roundcube），里面有在用的邮箱，暂时不能停。你又想用上 OpenMail 的 Webmail / AI 助手 / 模板 / 管理后台。
> 本教程让两者**同时运行、互不干扰**，并给出把子域名邮件**打通进 OpenMail** 的进阶方案。
>
> 姊妹篇：[BAOTA.md](BAOTA.md)（OpenMail 完全接管的形态 A/C 教程）。

---

## 目录

1. [先搞清楚：共存的代价](#一先搞清楚共存的代价)
2. [端口分配表（背下来）](#二端口分配表背下来)
3. [第一步：把 OpenMail 装到高位端口](#三第一步把-openmail-装到高位端口)
4. [第二步：放行高位端口](#四第二步放行高位端口)
5. [第三步：Webmail 反代站点（独立子域名）](#五第三步webmail-反代站点独立子域名)
6. [第四步：让 OpenMail 能给外部发信（三选一）](#六第四步让-openmail-能给外部发信三选一)
7. [进阶：让 `@om.你的域名` 的邮件进 OpenMail（推荐）](#七进阶让-om你的域名-的邮件进-openmail推荐)
8. [共存特有的排查表](#八共存特有的排查表)
9. [什么时候该结束共存（切换成接管）](#九什么时候该结束共存切换成接管)

---

## 一、先搞清楚：共存的代价

宝塔邮局的 Postfix 占着 **25 端口**，互联网发给你域名的信都进它手里。共存意味着 OpenMail 让出 25，由此产生三条铁律：

| # | 限制 | 影响 |
| --- | --- | --- |
| 1 | **OpenMail 收不到互联网来信**（MX 指向宝塔邮局） | 只能站内互发；外部来信全部进宝塔邮局的邮箱 |
| 2 | **OpenMail 直发外网可能失败**（国内云封出站 25，直投对方 MX 需要 25） | 必须走第六节的发信中继方案 |
| 3 | 客户端连 OpenMail 要用**高位端口** | Thunderbird 等填 1143/2587 而不是 993/587 |

第七节的「子域名打通」方案可以**同时解除限制 1 和 2**：让 `@om.example.com` 子域名的邮件经宝塔邮局的 Postfix 转交给 OpenMail，外发也借道 Postfix —— 这是共存的完全体，强烈推荐做完。

---

## 二、端口分配表（背下来）

| 服务 | 宝塔邮局（不动） | OpenMail（本教程） | 生产对应 |
| --- | --- | --- | --- |
| SMTP 收信（MX） | 25 | **2525** | 25 |
| Submission 发信 | 587 | **2587** | 587 |
| SMTPS 发信 | 465 | **2546** | 465 |
| IMAP | 143 | **1143** | 143 |
| IMAPS | 993 | **1993** | 993 |
| POP3 | 110 | **1110** | 110 |
| POP3S | 995 | **1995** | 995 |
| Webmail HTTP | Roundcube 站点（80/443） | **3000**（本机，反代出去） | —— |

---

## 三、第一步：把 OpenMail 装到高位端口

### 方式 1：适配脚本一键装（推荐）

SSH root 执行：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chenyuwebwawa/OpenMail/main/scripts/baota-adapt.sh) --keep-mailbox
```

`--keep-mailbox` 的意思就是「不碰宝塔邮局，OpenMail 用高位端口」。脚本会自动检测冲突、跳过停用、按高位端口写 `.env`。

### 方式 2：已经装过 OpenMail？改两个文件即可

如果你之前按接管模式装过（或手动装的），只需改 `.env` 的端口段：

```bash
vi /opt/openmail/app/.env
```

```ini
OM_SMTP_PORT=2525
OM_SUBMISSION_PORT=2587
OM_SMTPS_PORT=2546
OM_IMAP_PORT=1143
OM_IMAPS_PORT=1993
OM_POP3_PORT=1110
OM_POP3S_PORT=1995
```

```bash
systemctl restart openmail
```

### 验证互不打架

```bash
ss -ltnp | grep -E ':(25|2525|587|2587|143|1143)\s'
# 期望同时看到：25 → postfix，2525 → node，587 → postfix，2587 → node，143 → dovecot，1143 → node
```

看到 **postfix 和 node 各守各的端口**，共存的第一步就成了。

---

## 四、第二步：放行高位端口

两道门都要开（缺一不可）：

**① 宝塔面板 → 安全 → 防火墙 → 添加端口规则**（TCP）：

`2525、2587、2546、1143、1993、1110、1995`

**② 云服务商控制台 → 安全组 → 入方向**：同样这 7 个端口。

> 3000 端口**不用放行公网**——下一节用反向代理从 443 进。

---

## 五、第三步：Webmail 反代站点（独立子域名）

给 OpenMail 一个**不与宝塔邮局 Roundcube 冲突**的子域名，例如 `ommail.example.com`。

1. **DNS 加一条 A 记录**：`ommail` → 服务器公网 IP。
2. **宝塔面板 → 网站 → 添加站点**：
   - 域名：`ommail.example.com`
   - PHP 版本：纯静态；不建数据库、不建 FTP
3. 站点 → **反向代理 → 添加反向代理**：
   - 目标 URL：`http://127.0.0.1:3000`
   - 发送域名：`$host`
4. 点代理的 **配置文件**，确保包含：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
client_max_body_size 30m;
```

5. 站点 → **SSL** → Let's Encrypt → 申请 `ommail.example.com` 证书 → 开启强制 HTTPS。
6. **把证书回填给 OpenMail**（IMAPS/SMTPS 用）：

```bash
chmod -R o+rx /www/server/panel/vhost/cert/ommail.example.com
cat >> /opt/openmail/app/.env <<'EOF'
OM_TLS_CERT=/www/server/panel/vhost/cert/ommail.example.com/fullchain.pem
OM_TLS_KEY=/www/server/panel/vhost/cert/ommail.example.com/privkey.pem
OM_BASE_URL=https://ommail.example.com
EOF
systemctl restart openmail
```

浏览器打开 `https://ommail.example.com` → OpenMail 官网 → 进入邮箱登录。✅ 共存基础版完成——现在可以站内互发、用 AI 助手、建模板了。

---

## 六、第四步：让 OpenMail 能给外部发信（三选一）

OpenMail 的站外信先进队列，由「外发中继」投出去。共存场景给三种方案，**推荐方案 A**：

### 方案 A：借道宝塔邮局的 Postfix 中继（推荐，不受云封 25 影响）

用一个宝塔邮局的邮箱账号作为发信中继（专门建一个 `relay@example.com` 也行）：

```bash
vi /opt/openmail/app/.env
```

```ini
OM_RELAY_HOST=mail.example.com      # 宝塔邮局的收发服务器地址
OM_RELAY_PORT=587
OM_RELAY_SECURE=false               # 587 走 STARTTLS
OM_RELAY_USER=relay@example.com     # 宝塔邮局里建的账号
OM_RELAY_PASS=该账号的密码
```

```bash
systemctl restart openmail
```

原理：OpenMail 外发信通过本机 Postfix 的 587 端口（SASL 认证）转发到互联网，借用了宝塔邮局现成的出站能力。后台「外发队列」里状态变 `sent` 即成功。

> 该中继账号的发信频率受宝塔邮局策略限制，量大请配合方案 B。

### 方案 B：Postfix 放行本机免认证（无账号密码，更省心）

让 Postfix 信任本机回环地址，OpenMail 直接连它的 25 端口中继：

```bash
# 查看当前 mynetworks
postconf mynetworks
# 追加本机网段（保留原有内容，逗号分隔）
postconf -e 'mynetworks = 127.0.0.0/8, [::1]/128'
systemctl restart postfix   # 宝塔邮局的 postfix 服务名可能是 postfix，若失败试: systemctl restart mail_sys
```

```ini
# .env 里这样配（连本机 25，无需账号密码）
OM_RELAY_HOST=127.0.0.1
OM_RELAY_PORT=25
```

> ⚠️ 只放行 `127.0.0.0/8`，**不要**把 `0.0.0.0/0` 写进去（会变成开放中继，被拿来发垃圾邮件，IP 秒进黑名单）。

### 方案 C：直投 MX（仅海外不封 25 出站的云）

`.env` 不配 `OM_RELAY_*` 即为直投模式。国内云基本都封，失败表现是外发队列反复重试后 `failed`。

---

## 七、进阶：让 `@om.你的域名` 的邮件进 OpenMail（推荐）

做完这一步，共存就不是「阉割版」了：**老邮箱继续用宝塔邮局，新邮箱用 `@om.example.com` 走 OpenMail**，两套并行。

原理一句话：给子域名加 MX（还指向同一台服务器），Postfix 收到 `*@om.example.com` 后不投本地 Dovecot，而是**转交给本机 2525 端口的 OpenMail**。

### 7.1 DNS 加子域名记录

| 类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| MX | `om` | `mail.example.com`（优先级 10） |
| TXT (SPF) | `om` | `v=spf1 mx ~all` |
| A | `mail` | 已有，不动 |

### 7.2 OpenMail 后台托管子域名

OpenMail 管理后台 → **域名管理 → 添加域名** → 填 `om.example.com`（自动生成 DKIM）→ 点 **DNS 配置**，把给出的 `om1._domainkey.om.example.com`（DKIM）和 `_dmarc.om.example.com`（DMARC）两条 TXT 也加到 DNS。然后创建几个 `xxx@om.example.com` 的用户。

### 7.3 配置 Postfix 把子域名转给 OpenMail

SSH 执行（宝塔邮局的 Postfix 通用做法）：

```bash
# 1. 找到 Postfix 配置目录
postconf -h config_directory        # 一般输出 /etc/postfix

# 2. 声明 relay 域 + 传输映射（注意保留已有 relay_domains，先查看）
postconf relay_domains
postconf -e 'relay_domains = om.example.com'          # 若原来有值，写成 原值, om.example.com
postconf -e 'transport_maps = hash:/etc/postfix/transport'

# 3. 写传输规则：om.example.com 全部转交本机 2525
echo 'om.example.com smtp:[127.0.0.1]:2525' > /etc/postfix/transport
postmap /etc/postfix/transport

# 4. 重载 Postfix
systemctl reload postfix    # 或 systemctl restart mail_sys（宝塔邮局的服务名）
```

### 7.4 验证子域名链路

用 QQ/Gmail 发一封到 `你建的用户@om.example.com`：

```bash
# 实时观察两头
journalctl -u postfix -f        # Postfix 收下并 relay 给 127.0.0.1:2525
journalctl -u openmail -f       # OpenMail 收下入库
```

OpenMail 收件箱出现来信即打通 ✅。发信方向（OpenMail → 外部）走第六节的方案 A/B，天然借道 Postfix，无需额外配置。

> 常见失败点：
> - `relay_domains` 没加 → Postfix 报 `Relay access denied`；
> - `transport` 文件忘 `postmap` → 报 `table lookup failure`；
> - OpenMail 没托管 `om.example.com` → 2525 直接拒收（`收件人不存在`），Postfix 退信给发件人。

---

## 八、共存特有的排查表

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| OpenMail 起不来 `EADDRINUSE :25` | `.env` 端口段没改成高位 / 忘 restart | 第三节方式 2 逐行核对，`systemctl restart openmail` |
| 外部来信进不了 OpenMail | 这是共存的常态（MX 在宝塔邮局） | 做第七节子域名打通，或切形态 A |
| OpenMail 外发队列全 failed | 没配发信中继 / 中继账号密码错 | 第六节方案 A；看后台「外发队列」的错误列 |
| 中继报 `Relay access denied` | Postfix 不认这个客户端/账号 | 方案 A 检查 SASL 账号；方案 B 检查 mynetworks 含 127.0.0.0/8 |
| 子域名信件被 Postfix 退回 `unknown user` | transport 没生效 / relay_domains 没加 | 重做 7.3 的 postmap 与 reload |
| 子域名信件 OpenMail 报收件人不存在 | OpenMail 未托管 `om.example.com` | 7.2 后台添加域名 |
| 客户端连 1143 超时 | 高位端口没在宝塔+安全组放行 | 第四节两张清单 |
| Roundcube 和 OpenMail Cookie 打架 | 同一域名下部署了两套 Webmail | 本教程用独立子域名 `ommail.`，天然隔离 |

---

## 九、什么时候该结束共存（切换成接管）

出现以下任一信号，就该做「形态 A」切换了（教程见 [BAOTA.md](BAOTA.md) 第二节与附章）：

- 宝塔邮局的老邮箱基本不用了 / 已完成 imapsync 迁移；
- 需要主域名 `@example.com` 的邮件直接进 OpenMail；
- 双栈维护成本开始超过收益（两套账户、两套反垃圾策略）。

切换路径：备份宝塔邮局数据 → 停用插件 → `.env` 端口改回标准端口 → `systemctl restart openmail` → DNS 不用动（MX 一直指着这台服务器）。
