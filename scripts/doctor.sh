#!/usr/bin/env bash
# =============================================================
#  OpenMail 一键自检诊断
#  用法: bash scripts/doctor.sh
#  输出可直接整段复制发给开发者
# =============================================================
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1

echo "╔════════════════════════════════════════════╗"
echo "║  OpenMail 自检诊断报告                     ║"
echo "╚════════════════════════════════════════════╝"

echo ""
echo "===== 1. 版本与服务状态 ====="
git log --oneline -1 2>/dev/null || echo "非 git 部署"
systemctl is-active openmail && echo "服务: 运行中" || echo "服务: 未运行!"
node --version

echo ""
echo "===== 2. 端口监听（应为空时报错） ====="
ss -ltnp 2>/dev/null | grep -E ':(25|587|465|143|993|110|995|3000|3001)\s' || echo "!! 没有监听任何邮件端口"

echo ""
echo "===== 3. 配置关键项（已脱敏） ====="
grep -E '^OM_(PRIMARY_DOMAIN|BASE_URL|ADMIN_EMAIL|HTTP_PORT|SMTP_PORT|SUBMISSION_PORT|IMAP_PORT|TLS_CERT|TLS_KEY|RELAY_HOST|RELAY_PORT)=' .env 2>/dev/null | sed 's/\(PASS[^=]*=\).*/\1***/'

echo ""
echo "===== 4. 域名 / 用户 / 外发队列（数据库实况） ====="
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/openmail.db');
console.log('域名:', JSON.stringify(db.prepare('SELECT id,name FROM domains').all()));
console.log('用户:', JSON.stringify(db.prepare('SELECT address,role,status FROM users').all()));
const q=db.prepare('SELECT sender,recipient,status,attempts,substr(last_error,1,100) AS err FROM outbound_queue ORDER BY id DESC LIMIT 5').all();
console.log('外发队列(近5条):', JSON.stringify(q));
" 2>&1

echo ""
echo "===== 5. 公网 DNS 解析 ====="
DOMAIN=$(grep '^OM_PRIMARY_DOMAIN=' .env 2>/dev/null | cut -d= -f2)
HOST=$(grep '^OM_BASE_URL=' .env 2>/dev/null | cut -d= -f2 | sed 's|https\?://||; s|[:/].*||')
echo "主机 $HOST 的 A 记录:"; getent hosts "$HOST" | head -2
echo "域名 $DOMAIN 的 MX 记录:"; (dig +short MX "$DOMAIN" 2>/dev/null || nslookup -type=MX "$DOMAIN" 2>/dev/null | tail -4) | head -4

echo ""
echo "===== 6. 本机 25 端口横幅 ====="
timeout 5 bash -c 'exec 3<>/dev/tcp/127.0.0.1/25; head -1 <&3' 2>/dev/null || echo "!! 本机 25 无响应"

echo ""
echo "===== 7. 最近日志（错误/收发记录） ====="
journalctl -u openmail -n 80 --no-pager 2>/dev/null | grep -E "smtp|mail|migrate|错误|失败|error|Error|uncaught" | tail -30

echo ""
echo "===== 8. 外部可达性自测提示 ====="
echo "本机自测通过 ≠ 外部可达。请用手机热点（或在线工具 mxtoolbox.com）测试:"
echo "  telnet $HOST 25   —— 能看到 220 才说明外部真的连得进来"

echo ""
echo "===== 诊断结束：请整段复制以上全部内容 ====="
