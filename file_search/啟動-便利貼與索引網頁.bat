@echo off
setlocal
title Sticky Wall + Index Wall (web)
cd /d "%~dp0"

echo ============================================================
echo   file_search web apps  (both from one command)
echo     Sticky notes  ^(bian-li-tie^)  http://localhost:5273
echo     File index    ^(suo-yin^)      http://localhost:5274
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js not found.
  echo Install the LTS version from https://nodejs.org/ and run this again.
  echo.
  pause
  exit /b 1
)

REM ---- first-run dependency install (idempotent; skipped once present) ----
if exist "node_modules\" goto have_root
echo [setup] installing launcher deps ...
call npm install
if %errorlevel% neq 0 goto installfail
:have_root

if exist "sticky-wall-web\node_modules\" goto have_sticky
echo [setup] installing sticky-wall-web deps ^(first run, ~30s^) ...
call npm --prefix sticky-wall-web install
if %errorlevel% neq 0 goto installfail
:have_sticky

if exist "index-wall-web\node_modules\" goto have_index
echo [setup] installing index-wall-web deps ^(first run, ~30s^) ...
call npm --prefix index-wall-web install
if %errorlevel% neq 0 goto installfail
:have_index

echo Starting dev servers ^(4 processes: 2 API + 2 Vite^) ...
start "file_search web - dev servers (keep open)" cmd /k npm run dev

echo Waiting for Vite to come up ...
ping -n 7 127.0.0.1 >nul

echo Opening browser ...
start "" "http://localhost:5273"
start "" "http://localhost:5274"

echo.
echo Done. The other window ("dev servers") is running the sites.
echo Closing THAT window stops both. You can close this one now.
pause
exit /b 0

:installfail
echo.
echo [Error] npm install failed - see the messages above.
pause
exit /b 1
