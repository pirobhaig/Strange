@echo off
title STRANGE — Windows 10 Installer Builder
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js 20+ is required one time on your build PC to compile the .exe installer.
  echo Download Node.js LTS from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)

echo [1/3] Installing dependencies + Electron builder...
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (
  echo Retrying with --legacy-peer-deps...
  call npm install --legacy-peer-deps --no-audit --no-fund
  if %errorlevel% neq 0 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

call npm install -D electron electron-builder --no-audit --no-fund
if %errorlevel% neq 0 (
  echo Retrying Electron install with --legacy-peer-deps...
  call npm install -D electron electron-builder --legacy-peer-deps --no-audit --no-fund
  if %errorlevel% neq 0 (
    echo Electron installation failed.
    pause
    exit /b 1
  )
)

echo [2/3] Building frontend, compiled backend, and Windows 10 .exe installer...
call npm run electron:build:win
if %errorlevel% neq 0 (
  echo Installer build failed. See errors above.
  pause
  exit /b 1
)

echo [3/3] Done! Your Windows installer is ready inside the "release" folder.
explorer "%~dp0release"
pause
