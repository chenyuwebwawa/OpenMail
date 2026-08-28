#!/usr/bin/env bash
# =============================================================
#  OpenMail 一键安装脚本（Linux 普通服务器）
#
#  远程一键安装:
#    curl -fsSL https://raw.githubusercontent.com/chenyuwebbawa/OpenMail/main/install.sh | bash
#  或下载后执行:
#    bash install.sh [--domain example.com] [--dir /opt/openmail] [--port 3000] [--standard-ports]
#
#  脚本行为：
#    1. 检查/安装 Node.js >= 22
#    2. 拉取源码到安装目录
#    3. 安装依赖 + 生成 .env
#    4. 创建 systemd 服务并启动（含 1024 以下端口绑定能力）
#    5. 打印管理员账号与后续步骤（DNS / 面板 / 语言包）
# =============================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/chenyuwebbawa/OpenMail.git}"
INSTALL_DIR="/opt/openmail"
SERVICE_USER="openmail"
DOMAIN=""
HTTP_PORT="3000"
STANDARD_PORTS=false
BRANCH="main"

c_info()  { echo -e "\033[1;34m[INFO]\033[0m $*"; }
c_ok()    { echo -e "\033[1;32m[ OK ]\033[0m $*"; }
c_warn()  { echo -e "\033[1;33m[WARN]\033[0m $*"; }
c_err()   { echo -e "\033[1;31m[FAIL]\033[0m $*"; exit 1; }

# ---------- 参数 ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2;;
    --dir) INSTALL_DIR="$2"; shift 2;;
    --port) HTTP_PORT="$2"; shift 2;;
    --standard-ports) STANDARD_PORTS=true; shift;;
    --branch) BRANCH="$2"; shift 2;;
    -h|--help)
      grep '^#' "$0" | head -20; exit 0;;
    *) c_err "未知参数: $1";;
  esac
done

[[ $EUID -eq 0 ]] || c_err "请用 root 运行（sudo bash install.sh）"

echo "=============================================="
echo "   OpenMail 一键安装"
echo "   安装目录 : ${INSTALL_DIR}"
echo "   域名     : ${DOMAIN:-（稍后配置，默认 localhost）}"
echo "   HTTP端口 : ${HTTP_PORT}"
echo "   邮件端口 : $(${STANDARD_PORTS} && echo '标准 25/587/465/143/993/110/995' || echo '开发端口 2525/2587/…')"
echo "=============================================="

# ---------- 1. 系统依赖 ----------
c_info "检查系统依赖…"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl git ca-certificates >/dev/null
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y -q curl git ca-certificates >/dev/null
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q curl git ca-certificates >/dev/null
else
  c_warn "未识别的包管理器，假设 curl/git/Node 已就绪"
fi

# ---------- 2. Node.js >= 22 ----------
need_node=true
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  [[ "$NODE_MAJOR" -ge 22 ]] && need_node=false && c_ok "Node.js $(node --version) 已满足"
fi
if $need_node; then
  c_info "安装 Node.js 22.x…"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null
    dnf install -y -q nodejs >/dev/null
  else
    c_err "请手动安装 Node.js >= 22.5 后重试"
  fi
  c_ok "Node.js $(node --version)"
fi

# ---------- 3. 源码 ----------
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  c_info "已存在目录，执行 git pull 更新…"
  git -C "${INSTALL_DIR}" pull --ff-only || true
else
  c_info "克隆源码到 ${INSTALL_DIR} …"
  git clone --depth 1 -b "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
fi
cd "${INSTALL_DIR}"

# ---------- 4. 服务用户 ----------
if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  c_info "创建系统用户 ${SERVICE_USER}…"
  useradd -r -m -d "${INSTALL_DIR}" -s /usr/sbin/nologin "${SERVICE_USER}" 2>/dev/null || useradd -r -m -s /usr/sbin/nologin "${SERVICE_USER}"
fi
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

# ---------- 5. 依赖 + .env ----------
c_info "安装 npm 依赖（跳过开发依赖）…"
sudo -u "${SERVICE_USER}" npm install --omit=dev --no-audit --no-fund >/dev/null

if [[ ! -f .env ]]; then
  c_info "生成 .env …"
  SECRET=$(node -p 'require("crypto").randomBytes(32).toString("hex")')
  SMTP_PORT=2525; SUBMISSION_PORT=2587; SMTPS_PORT=2546
  IMAP_PORT=1143; IMAPS_PORT=1993; POP3_PORT=1110; POP3S_PORT=1995
  if $STANDARD_PORTS; then
    SMTP_PORT=25; SUBMISSION_PORT=587; SMTPS_PORT=465
    IMAP_PORT=143; IMAPS_PORT=993; POP3_PORT=110; POP3S_PORT=995
  fi
  BASE_URL="http://localhost:${HTTP_PORT}"
  [[ -n "$DOMAIN" ]] && BASE_URL="https://mail.${DOMAIN}"
  cat > .env <<EOF
OM_SITE_NAME=OpenMail
OM_PRIMARY_DOMAIN=${DOMAIN:-localhost}
OM_BASE_URL=${BASE_URL}
OM_ADMIN_EMAIL=admin@${DOMAIN:-localhost}
OM_SECRET=${SECRET}
OM_HTTP_PORT=${HTTP_PORT}
OM_SMTP_PORT=${SMTP_PORT}
OM_SUBMISSION_PORT=${SUBMISSION_PORT}
OM_SMTPS_PORT=${SMTPS_PORT}
OM_IMAP_PORT=${IMAP_PORT}
OM_IMAPS_PORT=${IMAPS_PORT}
OM_POP3_PORT=${POP3_PORT}
OM_POP3S_PORT=${POP3S_PORT}
OM_REGISTRATION=true
EOF
  chown "${SERVICE_USER}:${SERVICE_USER}" .env
  chmod 600 .env
  c_ok ".env 已生成（可用编辑器进一步修改）"
fi

# ---------- 6. systemd ----------
c_info "写入 systemd 服务…"
cat > /etc/systemd/system/openmail.service <<EOF
[Unit]
Description=OpenMail Server
After=network.target

[Service]
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now openmail
sleep 3
systemctl is-active openmail >/dev/null || { journalctl -u openmail -n 30 --no-pager; c_err "服务启动失败"; }
c_ok "OpenMail 服务已启动（systemd: openmail）"

# ---------- 7. 防火墙提示 ----------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "active"; then
  c_info "检测到 ufw 已启用，放行端口…"
  $STANDARD_PORTS && ufw allow 25,587,465,143,993,110,995,80,443,${HTTP_PORT}/tcp >/dev/null \
                  || ufw allow 2525,2587,2546,1143,1993,1110,1995,${HTTP_PORT}/tcp >/dev/null
  c_ok "ufw 规则已添加"
fi

# ---------- 8. 语言包 ----------
c_info "安装全部界面语言包（10 种语言）…"
sudo -u "${SERVICE_USER}" node scripts/install-langpacks.mjs --all || c_warn "语言包安装失败，可稍后手动执行 node scripts/install-langpacks.mjs --all"

# ---------- 9. 输出 ----------
ADMIN_CREDS=$(grep -oP '(?<=密码: ).*' "${INSTALL_DIR}/data/admin-credentials.txt" 2>/dev/null || echo "见 ${INSTALL_DIR}/data/admin-credentials.txt")
IP=$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || echo "<服务器IP>")
echo
echo "=============================================="
echo "  🎉 OpenMail 安装完成！"
echo "----------------------------------------------"
echo "  Webmail/管理后台 : http://${IP}:${HTTP_PORT}"
echo "  管理员账号       : admin@${DOMAIN:-localhost}"
echo "  管理员密码       : ${ADMIN_CREDS}"
echo "----------------------------------------------"
echo "  下一步:"
echo "   1. 浏览器打开上面的地址登录管理后台"
echo "   2. 管理后台 → 域名管理: 添加你的域名并按 DNS 配置页设置解析"
$STANDARD_PORTS || echo "   3. 当前为开发端口，公网可用 Nginx/宝塔 反代或加 --standard-ports 重装"
echo "   3. 界面语言: 设置 → 语言（已预装 10 语言包）"
echo "   4. 面板用户: 见 docs/panels/BAOTA.md 与 docs/panels/1PANEL.md"
echo "   5. 生产部署细节: docs/DEPLOYMENT.md"
echo "=============================================="
