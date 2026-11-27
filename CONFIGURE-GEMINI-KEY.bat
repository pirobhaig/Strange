@echo off
title STRANGE — Secure Gemini API Key Setup (Windows)
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ============================================================
echo   STRANGE — Secure Local Gemini API Key Configuration
echo ============================================================
echo.
echo Your key is stored ONLY in a user-restricted local .env file
echo on your computer (never shown in browser JS or chat backups).
echo.
echo   [1] Save or Update Gemini API Key (masked input)
echo   [2] Remove Saved Gemini API Key
echo   [3] Check Configuration Status (key hidden)
echo   [4] Exit
echo.
set /p CHOICE="Choose an option (1-4): "

if "%CHOICE%"=="1" goto SAVE_KEY
if "%CHOICE%"=="2" goto REMOVE_KEY
if "%CHOICE%"=="3" goto CHECK_STATUS
exit /b 0

:SAVE_KEY
echo.
echo Paste or type your Google Gemini API key (input is hidden):
powershell -NoProfile -Command ^
  "$sec = Read-Host 'GEMINI_API_KEY' -AsSecureString; " ^
  "$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec); " ^
  "$key = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr).Trim(); " ^
  "[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); " ^
  "if ($key.Length -lt 12 -or $key -match '\s') { Write-Host 'ERROR: Key appears empty, too short, or contains spaces.' -ForegroundColor Red; exit 1 }; " ^
  "$envPath = Join-Path (Get-Location) '.env'; " ^
  "$lines = @(); " ^
  "if (Test-Path $envPath) { $lines = Get-Content $envPath | Where-Object { $_ -notmatch '^GEMINI_API_KEY=' } }; " ^
  "$lines += ('GEMINI_API_KEY=' + $key); " ^
  "Set-Content -Path $envPath -Value $lines -Encoding UTF8; " ^
  "Write-Host 'Saved GEMINI_API_KEY to local .env successfully (value hidden).' -ForegroundColor Green"

if %errorlevel% neq 0 (
  echo.
  echo Key was NOT saved. Please check your Gemini API key and try again.
  pause
  exit /b 1
)

rem Lock .env permissions to the current Windows user only
icacls ".env" /inheritance:r /grant:r "%USERNAME%:(R,W)" >nul 2>nul

echo.
echo Permissions locked to Windows user: %USERNAME%
echo STRANGE reloads .env dynamically on every request (no source edits needed).
echo You can now run OPEN-STRANGE.bat or test the connection in STRANGE Settings.
echo.
pause
exit /b 0

:REMOVE_KEY
powershell -NoProfile -Command ^
  "$envPath = Join-Path (Get-Location) '.env'; " ^
  "if (-not (Test-Path $envPath)) { Write-Host 'No local .env file found.' -ForegroundColor Yellow; exit 0 }; " ^
  "$lines = Get-Content $envPath | Where-Object { $_ -notmatch '^GEMINI_API_KEY=' }; " ^
  "Set-Content -Path $envPath -Value $lines -Encoding UTF8; " ^
  "Write-Host 'Removed GEMINI_API_KEY from local .env.' -ForegroundColor Green"
echo.
pause
exit /b 0

:CHECK_STATUS
powershell -NoProfile -Command ^
  "$envPath = Join-Path (Get-Location) '.env'; " ^
  "if (-not (Test-Path $envPath)) { Write-Host 'Status: NOT CONFIGURED (no local .env file).' -ForegroundColor Yellow; exit 0 }; " ^
  "$match = Get-Content $envPath | Where-Object { $_ -match '^GEMINI_API_KEY=(.+)$' }; " ^
  "if ($match) { Write-Host 'Status: CONFIGURED in local .env (value hidden).' -ForegroundColor Green } else { Write-Host 'Status: NOT CONFIGURED in local .env.' -ForegroundColor Yellow }"
echo.
pause
exit /b 0
