@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22.13 or newer, then reopen this file.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Run npm ci in this folder first.
  pause
  exit /b 1
)
if not exist .env.local (
  echo Run npm run setup and configure DATABASE_URL in .env.local first.
  pause
  exit /b 1
)
echo Staff Schedule: http://localhost:3000
call npm run dev
pause
