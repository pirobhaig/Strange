@echo off
title STRANGE — Local Launcher
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js 20+ is required to run from source or build the .exe installer.
  echo Download Node.js LTS from https://nodejs.org/ then run this script again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
  if %errorlevel% neq 0 (
    echo Retrying with --legacy-peer-deps...
    call npm install --legacy-peer-deps --no-audit --no-fund
    if %errorlevel% neq 0 (
      echo npm install failed.
      pause
      exit /b 1
    )
  )
)

echo Starting STRANGE on http://localhost:3000 ...
start "" "http://localhost:3000"
call npm run dev
pause
