@echo off
chcp 65001 >nul
title OpenMail - Windows 启动器
cd /d "%~dp0"

echo ==============================================
echo   OpenMail Windows 启动器
echo ==============================================

where node >nul 2>nul
if errorlevel 1 (
  echo [X] 未检测到 Node.js，请先安装 Node.js 22 以上版本: https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/2] 首次运行，安装依赖…
  call npm install --no-audit --no-fund
)

echo [2/2] 启动 OpenMail…
echo.
echo   Webmail/管理后台: http://localhost:3000
echo   SMTP: 2525  Submission: 2587  IMAP: 1143  POP3: 1110
echo   管理员凭据在 data\admin-credentials.txt
echo   界面语言: 设置 - 语言（可运行 npm run langpacks 查看语言包）
echo.
start "" http://localhost:3000
node server/index.js
pause
