@echo off
title STRANGE - Secure Gemini API Key Setup
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js 20+ is required to configure and run STRANGE.
  echo Download Node.js LTS from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

node "%~dp0scripts\configure-key.mjs"
echo.
pause
