#!/usr/bin/env bash
# =============================================================
#  OpenMail × 宝塔面板 适配脚本
#
#  用途：在装有宝塔面板的服务器上部署/适配 OpenMail：
#    1. 检测并处置与「宝塔邮局」插件（Postfix/Dovecot）的端口冲突
#    2. 可选：停用宝塔邮局，OpenMail 完全接管邮件服务（推荐）
#    3. 注册 systemd 服务（非 root 运行）
#    4. 输出宝塔「网站 → 反向代理」所需的配置说明
#
#  用法（root）:
#    bash scripts/baota-adapt.sh            # 交互式
#    bash scripts/baota-adapt.sh --keep-mailbox   # 不动宝塔邮局，OpenMail 用开发端口
# =============================================================
set -euo pipefail

c_info() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
c_ok()   { echo -e "\033[1;32m[ OK ]\033[0m $*"; }
c_warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }

KEEP_MAILBOX=false
[[ "${1:-}" == "--keep-mailbox" ]] && KEEP_MAILBOX=true

[[ $EUID -eq 0 ]] || { echo "请用 root 运行"; exit 1; }

echo "=============================================="
echo "  OpenMail × 宝塔面板 适配"
echo "=============================================="

# ---------- 1. 检测宝塔邮局占用的端口 ----------
c_info "检测邮件端口占用…"
check_port() {
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "(:|])$1$"; then
    return 0  # 占用
  fi
  return 1
}

conflict=()
for p in 25 587 465 143 993 110 995; do
  if check_port "$p"; then
    proc=$(ss -ltnp 2>/dev/null | grep -E "(:|])$p " | head -1 | grep -oP '(?<=users:\(\(")[^"]+' || echo "未知进程")
    conflict+=("$p:$proc")
    c_warn "端口 $p 已被占用（$proc）"
  fi
done

if [[ ${#conflict[@]} -eq 0 ]]; then
  c_ok "无端口冲突，OpenMail 可直接使用标准邮件端口"
  MODE="standard"
else
  echo
  echo "  检测到端口被占用，通常来自「宝塔邮局」插件（Postfix/Dovecot）。两种方案："
  echo "    A) 停用宝塔邮局插件，OpenMail 完全接管（推荐，二者都是完整邮件服务器，不建议同时开）"
  echo "    B) 保留宝塔邮局，OpenMail 使用开发端口(2525/2587/...)，仅经反代对外提供 Webmail"
  if $KEEP_MAILBOX; then
    MODE="dev"; c_info "已按参数选择方案 B"
  else
    read -rp "选择方案 [A/B]（默认 A）: " ans
    MODE=$([[ "${ans,,}" == "b" ]] && echo dev || echo standard)
  fi
  if [[ "$MODE" == "standard" ]]; then
    c_info "停用宝塔邮局相关服务（postfix/dovecot）…"
    for svc in postfix dovecot; do
      if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}"; then
        systemctl stop "$svc" 2>/dev/null || true
        systemctl disable "$svc" 2>/dev/null || true
        c_ok "  $svc 已停止并禁用"
      fi
    done
    # 宝塔邮局插件自启配置
    [[ -f /www/server/panel/plugin/mail_sys ]] && c_warn "提示：宝塔面板中请勿再手动启动「邮局」插件，否则端口会再次冲突"
  fi
fi

# ---------- 2. 安装 OpenMail（若未装） ----------
INSTALL_DIR="/opt/openmail"
if [[ ! -f "${INSTALL_DIR}/server/index.js" ]]; then
  c_info "未检测到 OpenMail，开始安装…"
  INSTALL_ARGS=(--dir "${INSTALL_DIR}")
  [[ "$MODE" == "standard" ]] && INSTALL_ARGS+=(--standard-ports)

  INSTALLED=false
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"

  # 1) 优先使用同仓库自带的 install.sh（git clone 之后运行本脚本的场景）
  if [[ -f "${SCRIPT_DIR}/../install.sh" ]]; then
    c_info "使用本地 install.sh: ${SCRIPT_DIR}/../install.sh"
    bash "${SCRIPT_DIR}/../install.sh" "${INSTALL_ARGS[@]}" && INSTALLED=true
  else
    # 2) 远程获取：raw（带缓存穿透参数）→ jsDelivr 国内友好镜像
    for U in \
      "https://raw.githubusercontent.com/chenyuwebwawa/OpenMail/main/install.sh?_=$(date +%s)" \
      "https://cdn.jsdelivr.net/gh/chenyuwebwawa/OpenMail@main/install.sh"; do
      c_info "获取 install.sh: ${U%%\?*}"
      if bash <(curl -fsSL "$U") "${INSTALL_ARGS[@]}"; then INSTALLED=true; break; fi
      c_warn "该源获取失败，尝试下一个镜像…"
    done
    # 3) 兜底：直接 git clone（github.com 主站一般可达）
    if ! $INSTALLED; then
      c_info "退回 git clone 安装方式…"
      rm -rf "${INSTALL_DIR}"
      if git clone --depth 1 https://github.com/chenyuwebwawa/OpenMail.git "${INSTALL_DIR}"; then
        (cd "${INSTALL_DIR}" && bash install.sh "${INSTALL_ARGS[@]}") && INSTALLED=true
      fi
    fi
  fi
fi
[[ -f "${INSTALL_DIR}/server/index.js" ]] || { echo "OpenMail 未安装成功。国内网络请改用："; echo "  git clone https://github.com/chenyuwebwawa/OpenMail.git /opt/openmail"; echo "  cd /opt/openmail && bash install.sh --standard-ports"; exit 1; }

# 若已装但模式变了，提示改 .env
if [[ "$MODE" == "standard" ]]; then
  sed -i 's/^OM_SMTP_PORT=.*/OM_SMTP_PORT=25/; s/^OM_SUBMISSION_PORT=.*/OM_SUBMISSION_PORT=587/; s/^OM_SMTPS_PORT=.*/OM_SMTPS_PORT=465/; s/^OM_IMAP_PORT=.*/OM_IMAP_PORT=143/; s/^OM_IMAPS_PORT=.*/OM_IMAPS_PORT=993/; s/^OM_POP3_PORT=.*/OM_POP3_PORT=110/; s/^OM_POP3S_PORT=.*/OM_POP3S_PORT=995/' "${INSTALL_DIR}/.env" || true
else
  sed -i 's/^OM_SMTP_PORT=.*/OM_SMTP_PORT=2525/; s/^OM_SUBMISSION_PORT=.*/OM_SUBMISSION_PORT=2587/; s/^OM_SMTPS_PORT=.*/OM_SMTPS_PORT=2546/; s/^OM_IMAP_PORT=.*/OM_IMAP_PORT=1143/; s/^OM_IMAPS_PORT=.*/OM_IMAPS_PORT=1993/; s/^OM_POP3_PORT=.*/OM_POP3_PORT=1110/; s/^OM_POP3S_PORT=.*/OM_POP3S_PORT=1995/' "${INSTALL_DIR}/.env" || true
fi

# ---------- 3. 重启服务 ----------
systemctl restart openmail 2>/dev/null || systemctl enable --now openmail || true
sleep 2
systemctl is-active openmail >/dev/null && c_ok "openmail 服务运行中" || c_warn "openmail 未运行：journalctl -u openmail -n 30"

HTTP_PORT=$(grep -oP '(?<=^OM_HTTP_PORT=).*' "${INSTALL_DIR}/.env" || echo 3000)

# ---------- 4. 宝塔站点配置指引 ----------
echo
echo "=============================================="
echo " ✅ 适配完成。在宝塔面板中完成最后两步："
echo "----------------------------------------------"
echo " 1) 网站 → 添加站点："
echo "      域名: mail.你的域名.com（先在 DNS 加 A 记录指向本机 IP）"
echo "      不创建数据库、不创建 FTP"
echo " 2) 该站点 → 反向代理 → 添加反向代理:"
echo "      目标 URL: http://127.0.0.1:${HTTP_PORT}"
echo "      发送域名: \$host"
echo " 3) 站点 → SSL → Let's Encrypt 申请证书并开启「强制 HTTPS」"
echo "    然后在 ${INSTALL_DIR}/.env 设置:"
echo "      OM_TLS_CERT=/www/server/panel/vhost/cert/mail.你的域名.com/fullchain.pem"
echo "      OM_TLS_KEY=/www/server/panel/vhost/cert/mail.你的域名.com/privkey.pem"
echo "      OM_BASE_URL=https://mail.你的域名.com"
echo "    执行: systemctl restart openmail"
$([[ "$MODE" == "dev" ]] && echo " 4) 邮件客户端端口使用开发端口(2525/2587/1143/1110)，或在宝塔安全组放行后改回标准端口")
echo " 5) 宝塔 → 安全: 放行 ${HTTP_PORT}（建议只放行本机，走反代即可不放行公网）"
echo "----------------------------------------------"
echo " 详细图文步骤见仓库 docs/panels/BAOTA.md"
echo "=============================================="
