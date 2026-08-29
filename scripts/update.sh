#!/usr/bin/env bash
# =============================================================
#  OpenMail 一键更新脚本
#  用法:
#    bash scripts/update.sh            # 更新到最新版本
#    bash scripts/update.sh --check    # 只查看有没有新版本，不更新
#
#  说明：本脚本兼容「运行数据(data/ files/)已提交进仓库」的部署方式：
#    更新前先提交本机运行数据快照 → 拉取远程更新（冲突时以本机数据为准）
#    → 安装依赖 → 生成更新前完整备份(tar) → 重启服务。
# =============================================================
set -uo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1

# 检查模式
if [[ "${1:-}" == "--check" ]]; then
  git fetch origin 2>/dev/null
  echo "远程新提交（空 = 已是最新）:"
  git log --oneline HEAD..origin/main
  exit 0
fi

[[ $EUID -eq 0 ]] || { echo "请用 root 运行"; exit 1; }

echo "=============================================="
echo "  OpenMail 更新"
echo "=============================================="

echo "==> [1/6] 停止服务"
systemctl stop openmail 2>/dev/null || true

echo "==> [2/6] 备份运行数据与配置"
tar czf "${DIR}/../openmail-backup-$(date +%F-%H%M).tar.gz" -C "$DIR" data files .env 2>/dev/null \
  && echo "    已生成: $(dirname "$DIR")/openmail-backup-$(date +%F-%H%M).tar.gz" \
  || echo "    备份失败（继续更新，建议手动备份 data/ 后重试）"

echo "==> [3/6] 提交本机运行数据快照并拉取更新（冲突时以本机数据为准）"
git add -A >/dev/null 2>&1
git commit -m "runtime data snapshot $(date '+%F %T')" >/dev/null 2>&1 || true
git pull --no-rebase -X ours || { echo "拉取失败，请处理 git 冲突后重试"; exit 1; }

echo "==> [4/6] 安装依赖"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true

echo "==> [5/6] 修正权限"
SERVICE_USER=$(stat -c '%U' "$DIR/.env" 2>/dev/null || echo openmail)
chown -R "${SERVICE_USER}" "$DIR" 2>/dev/null || true

echo "==> [6/6] 启动服务"
systemctl start openmail
sleep 2
systemctl --no-pager status openmail | head -4

echo ""
echo "✅ 更新完成。浏览器强制刷新（Ctrl+F5）即可看到新版本。"
echo "   数据库结构变更会在启动时自动迁移，可用 journalctl -u openmail -n 10 确认。"
echo "   回滚方法: ls $(dirname "$DIR")/openmail-backup-*.tar.gz 解压覆盖 data/ files/ .env 后重启。"
