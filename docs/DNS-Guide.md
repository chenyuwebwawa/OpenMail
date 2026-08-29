# DNS 配置指南 / DNS Configuration Guide

邮件服务器对 DNS 的依赖远比 Web 服务器严格。**以下记录缺一不可**，配置错误最直接的后果是：发出去的邮件进对方垃圾箱，甚至被直接拒收。

## 必配记录（四项 + PTR）

假设：

- 邮件域名：`example.com`
- 邮件主机名：`mail.example.com`
- 服务器公网 IP：`203.0.113.10`

| 记录类型 | 主机记录 | 记录值 | 说明 |
| --- | --- | --- | --- |
| **A** | `mail` | `203.0.113.10` | 邮件服务器主机名 → 服务器 IP |
| **MX** | `@` | `mail.example.com`（优先级 10） | 告诉其他服务器：发给 `*@example.com` 的邮件投递到这里 |
| **TXT（SPF）** | `@` | `v=spf1 mx ip4:203.0.113.10 ~all` | 声明"只有这些 IP 有权替我发信" |
| **TXT（DKIM）** | `om1._domainkey` | `v=DKIM1; k=rsa; p=MIIBIjANBg…` | DKIM 公钥（OpenMail 自动生成，管理后台可直接复制） |
| **TXT（DMARC）** | `_dmarc` | `v=DMARC1; p=none; rua=mailto:admin@example.com` | 验证失败策略 + 聚合报告邮箱 |
| **PTR（反向解析）** | `203.0.113.10` | `mail.example.com` | 在**云服务商控制台**设置，不在 DNS 服务商 |

> OpenMail 管理后台 → 域名管理 → **DNS 配置**，会按你的真实域名、DKIM 公钥和 IP 自动生成以上全部记录，每条带一键复制。

## SPF：从软失败到硬失败

```
v=spf1 mx ip4:203.0.113.10 ~all     ← 首次上线：~all（软失败，只标记不拒绝）
v=spf1 mx ip4:203.0.113.10 -all     ← 运行稳定一周后：-all（硬失败，直接拒绝）
```

- 如果还使用了第三方发信服务（如 SendGrid），要加 `include:`：
  `v=spf1 mx ip4:203.0.113.10 include:sendgrid.net ~all`
- **一条域名只能有一条 SPF TXT 记录**，多条会导致永久 PermError。

## DKIM

- OpenMail 默认选择器为 `om1`（可用 `OM_DKIM_SELECTOR` 修改），记录名即 `om1._domainkey.example.com`。
- 域名管理里可以**重新生成密钥**；换密钥后旧签名 72 小时内仍然有效（DNS 缓存），可以平滑轮换。
- 验证工具：给 `check-auth@verifier.port25.com` 发一封邮件，或使用 [DKIM-tester](https://dkimvalidator.com/)。

## DMARC：从观察到收紧

```
v=DMARC1; p=none; rua=mailto:admin@example.com            ← 起步：只收报告不拦截
v=DMARC1; p=quarantine; pct=50; rua=mailto:admin@…        ← 第二步：50% 隔离
v=DMARC1; p=reject; rua=mailto:admin@…                    ← 最终：全部拒绝
```

- `p=none` 阶段坚持收 1–2 周报告，确认所有合法发信渠道（官网、客服系统、营销平台）都通过 SPF/DKIM 后再收紧。
- `rua` 报告是 XML 附件，日均一封，可以用 dmarcian / Postmark 免费解析。

## 反向解析（PTR）

很多接收方（尤其 Gmail、Outlook、QQ 企业邮）**直接拒收没有 PTR 或 PTR 不匹配的 IP** 的来信。

> ⚠️ **PTR 不在你的 DNS 服务商（DNSPod/Cloudflare/阿里云解析）添加！**
> 你在 DNSPod 管理的是「域名 → IP」的正向解析；而 PTR 是「IP → 域名」的反向解析，IP 地址段属于**云服务商/VPS 商**，必须由他们设置。

各服务商的设置入口：

| 服务商 | 入口 |
| --- | --- |
| 腾讯云 | 控制台搜索「反向解析」自助绑定 EIP；无入口则提交工单 |
| 阿里云 | 提交工单申请（免费，1-2 个工作日） |
| Vultr / Hetzner / DMIT 等 | 面板 → 网络/IP → rDNS 设置 |
| AWS | 提交申请表单 |

**工单话术模板**：

> 请将服务器 `你的公网IP` 的反向解析（PTR/rDNS）指向 `mail.你的域名.com`。该 IP 上的邮件服务使用域名 `你的域名.com`（A 记录已指向该 IP），感谢。

- PTR 必须与邮件主机名一致且正反向闭环（`mail.example.com` → IP → 反解回 `mail.example.com`）；
- 主机名建议与 `OM_BASE_URL` / HELO 名一致；
- 若服务商拒绝配置 PTR → 放弃直投，改用 `OM_RELAY_*` 中继发信（中继服务商的 IP 自带合规 PTR；入站收信不受影响）。

## 送达率检查清单

上线后用这些服务做体检（都免费）：

| 工具 | 检查内容 |
| --- | --- |
| [mail-tester.com](https://www.mail-tester.com/) | 综合评分（目标 ≥ 9/10） |
| [MXToolbox](https://mxtoolbox.com/blacklists.aspx) | IP 是否在黑名单 |
| [Google Postmaster Tools](https://postmaster.google.com/) | Gmail 域名信誉 |
| `dig MX example.com` / `dig TXT …` | 记录是否全球生效 |

## 与所有主流邮箱互通的检查清单

自建邮件要和 QQ / 163 / Gmail / Outlook / 企业邮箱等**全部互通**，以下五项缺一不可（缺一项就会被某家拒收）：

| # | 检查项 | 在哪配置 | 谁最严格 |
| --- | --- | --- | --- |
| 1 | MX 记录指向邮件主机 | DNS 服务商 | 全部 |
| 2 | 入站 25 端口对外开放 | 云安全组 + 服务器防火墙 | 全部 |
| 3 | **PTR 反向解析 = 邮件主机名** | 云服务商控制台/工单 | **163 / Outlook**（无 PTR 常直接拒收） |
| 4 | **EHLO 名 = 邮件主机名** | OpenMail 已自动使用 `OM_BASE_URL` 的主机名 | **163**（机器名 EHLO 直接拒收） |
| 5 | SPF + DKIM + DMARC 三件套 | DNS 服务商（后台一键生成） | **Gmail / QQ**（无 DKIM 进垃圾箱） |

各家的"脾气"：

- **QQ 邮箱**：新域名首次发信大概率进垃圾箱，正常收发几天到几周后自动转正；DKIM 必配。
- **163 / 126**：对 EHLO 主机名和 PTR 校验最严格，且限频（同一 IP 每分钟有投递上限），群发务必放缓。
- **Gmail**：强制要求 STARTTLS + SPF/DKIM/DMARC 对齐，缺 DKIM 基本进垃圾箱；可在 [Google Postmaster](https://postmaster.google.com/) 观察 IP 信誉。
- **Outlook**：对 PTR 和营销类内容最敏感。
- **企业邮箱（腾讯企业邮/阿里邮箱）**：规则同个人版，但拒收更快。

**新服务器养信誉**：前两周只做少量正常内容的人际往来（每天几十封以内），避免群发和大量链接附件；[mail-tester](https://www.mail-tester.com) 得分 ≥ 9 后再放量。

## 常见坑

1. **国内云封 25 端口** —— 出站入站都封。解封需工单申请（困难），更现实的方案是配置 `OM_RELAY_*` 走 587 中继。
2. **端口 25 入站** —— Home broadband 封锁入站 25，家庭宽带无法自建，需要 VPS。
3. **新 IP 直接发信容易进垃圾箱** —— 新 IP 信誉为空白，先小量发信养信誉，避免群发。
4. **IPv6** —— 若服务器有 IPv6 且 AAAA/SPF 未配置，部分接收方会走 IPv6 路径导致验证失败；最简单的办法是在 SPF 中加 `ip6:` 或在系统层禁用出站 IPv6。
