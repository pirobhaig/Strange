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

REM Keep temp and cache inside this folder's drive so C: does not run out of space if moved to D:/E:/F:
if not exist "%~dp0.tmp-build" mkdir "%~dp0.tmp-build"
set "TEMP=%~dp0.tmp-build"
set "TMP=%~dp0.tmp-build"
set "ELECTRON_BUILDER_CACHE=%~dp0.tmp-build\eb-cache"

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
if exist "%~dp0release" rmdir /s /q "%~dp0release"
call npm run electron:build:win
if %errorlevel% neq 0 (
  echo.
  echo Installer build failed. If you see "not enough space on the disk",
  echo move this entire folder to a drive with at least 2 GB free (like D: or E:) and run again.
  pause
  exit /b 1
)

if exist "%~dp0.tmp-build" rmdir /s /q "%~dp0.tmp-build"
echo [3/3] Done! Your Windows installer is ready inside the "release" folder.
explorer "%~dp0release"
pause
