@echo off
setlocal
REM this file is ASCII-only on purpose (cp950 consoles mangle a UTF-8 .bat);
REM switch the console to UTF-8 so the Node server's log lines render readably.
chcp 65001 >nul
title Sticky Wall - LAN share mode
cd /d "%~dp0"

echo ============================================================
echo   Sticky notes wall . LAN share mode
echo   Let other people on your LAN use this wall from a browser.
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js not found. Install the LTS build: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "notes-web\node_modules\" (
  echo [setup] first run - installing notes-web deps ^(~30s^) ...
  call npm --prefix notes-web install
  if errorlevel 1 ( echo [Error] npm install failed & pause & exit /b 1 )
)

echo [build] building notes-web frontend ...
call npm --prefix notes-web run build
if errorlevel 1 ( echo [Error] build failed - see messages above & pause & exit /b 1 )

REM ---- shared password: read share-config.txt (gitignored) or ask now ----
set "SHARE_TOKEN="
if exist "share-config.txt" set /p SHARE_TOKEN=<share-config.txt
if defined SHARE_TOKEN goto haspw

echo.
set /p SHARE_TOKEN=Set a shared password (others type this to get in):
if not defined SHARE_TOKEN ( echo No password entered - aborting. & pause & exit /b 1 )
set /p SAVEPW=Save it to share-config.txt so you are not asked next time? (y/N):
if /i "%SAVEPW%"=="y" (
  echo %SHARE_TOKEN%>share-config.txt
  echo Saved to share-config.txt ^(this file is gitignored^).
)

:haspw
REM trim leading whitespace (guards a stray space from set /p)
for /f "tokens=* delims= " %%a in ("%SHARE_TOKEN%") do set "SHARE_TOKEN=%%a"
if not defined SHARE_TOKEN ( echo [Error] No password. & pause & exit /b 1 )

set SHARE_MODE=lan
REM Remote users cannot use AI by default (spends your quota / hits your Ollama).
REM Change to on to allow it:
set SHARE_AI=off
set NODE_ENV=production
set API_PORT=8787

echo.
echo ============================================================
echo   Started.
echo     You:          http://localhost:8787   (no password)
echo     Other people: use the "LAN share URL" the server prints
echo                   below - they must be on the same Wi-Fi/LAN.
echo   If Windows Firewall asks, choose "Allow access".
echo   Close this window to stop the service.
echo ============================================================
echo.

call npm --prefix notes-web run start

echo.
echo (server stopped)
pause
