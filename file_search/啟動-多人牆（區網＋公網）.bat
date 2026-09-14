@echo off
setlocal
REM ASCII-only on purpose (cp950 consoles mangle a UTF-8 .bat).
chcp 65001 >nul
title Multi Wall - LAN + Public share mode
cd /d "%~dp0"

echo ============================================================
echo   Multi wall . sticky notes + index wall, ONE login, ONE URL
echo   LAN always on. Optionally also open to the internet via ngrok.
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
if not exist "files-web\node_modules\" (
  echo [setup] first run - installing files-web deps ^(~30s^) ...
  call npm --prefix files-web install
  if errorlevel 1 ( echo [Error] npm install failed & pause & exit /b 1 )
)

echo [build] building notes-web frontend ...
call npm --prefix notes-web run build
if errorlevel 1 ( echo [Error] build failed - see messages above & pause & exit /b 1 )
echo [build] building files-web frontend ...
call npm --prefix files-web run build
if errorlevel 1 ( echo [Error] build failed - see messages above & pause & exit /b 1 )

REM ---- desktop shortcut: rebuilt every run so it always points at THIS .bat
REM      at its current location (moved the project / new PC? just run again).
REM      Icon source: share-gateway\assets\shortcut-icon.jpg -- swap that image
REM      and run again to change it. A failure here does not stop startup.
REM      PROJ_ROOT must NOT keep its trailing backslash: "%~dp0" quoted with a
REM      trailing "\" right before the closing quote gets parsed by
REM      powershell.exe's argv handling as an escaped quote, not a path
REM      separator -- this silently swallows the next argument (-BatPath).
set "PROJ_ROOT=%~dp0"
if "%PROJ_ROOT:~-1%"=="\" set "PROJ_ROOT=%PROJ_ROOT:~0,-1%"
echo [setup] ensuring desktop shortcut ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0share-gateway\make-shortcut.ps1" -ProjectRoot "%PROJ_ROOT%" -BatPath "%~f0"

REM ---- public? ----
set "SHARE_PUBLIC=off"
set /p WANTPUB=Also open to the public internet via ngrok? (y/N):
if /i "%WANTPUB%"=="y" set "SHARE_PUBLIC=on"

if "%SHARE_PUBLIC%"=="on" (
  where ngrok >nul 2>nul
  if errorlevel 1 (
    echo.
    echo [ngrok] not found on PATH. Install it, then run:
    echo         ngrok config add-authtoken ^<your token from dashboard.ngrok.com^>
    echo         Continuing LAN-only for now.
    set "SHARE_PUBLIC=off"
  )
)

REM ---- shared password: multi-wall-share-config.txt (gitignored) or ask now ----
REM Its own password file - separate from the sticky-wall's and index-wall's,
REM since this is a third, independent way to share (both walls, one login).
set "SHARE_TOKEN="
if exist "multi-wall-share-config.txt" set /p SHARE_TOKEN=<multi-wall-share-config.txt
if defined SHARE_TOKEN goto haspw

echo.
if "%SHARE_PUBLIC%"=="on" echo Public mode: pick a STRONG password ^(8+ chars; this is on the open internet^).
set /p SHARE_TOKEN=Set a shared password (others type this to get in):
if not defined SHARE_TOKEN ( echo No password entered - aborting. & pause & exit /b 1 )
set /p SAVEPW=Save it to multi-wall-share-config.txt so you are not asked next time? (y/N):
if /i "%SAVEPW%"=="y" (
  echo %SHARE_TOKEN%>multi-wall-share-config.txt
  echo Saved to multi-wall-share-config.txt ^(this file is gitignored^).
)

:haspw
REM trim leading whitespace (guards a stray space from set /p)
for /f "tokens=* delims= " %%a in ("%SHARE_TOKEN%") do set "SHARE_TOKEN=%%a"
if not defined SHARE_TOKEN ( echo [Error] No password. & pause & exit /b 1 )

REM ---- public mode needs an 8+ char password ----
if not "%SHARE_PUBLIC%"=="on" goto pwok
call :strlen SHARE_TOKEN PWLEN
if %PWLEN% LSS 8 (
  echo.
  echo [Error] Public mode needs a password of at least 8 characters ^(yours: %PWLEN%^).
  echo         Edit multi-wall-share-config.txt ^(or delete it and run again^) to fix.
  pause
  exit /b 1
)
:pwok

REM ---- one-time random secret so the gateway can prove "this came from me"
REM      to the two backends (see share-gateway/index.mjs) ----
for /f %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString(\"N\")"') do set GATEWAY_SECRET=%%i

set SHARE_AI=off
REM Ports: 8790/8791 are the two standalone single-wall launchers' public
REM ports; 8792/8793 are these two backends' *internal* ports behind this
REM gateway; 8794 is the gateway's own (only) public port. Three ways to run
REM this project can all be open at once without fighting over a port.
set GATEWAY_PORT=8794
set NOTES_TARGET_PORT=8792
set FILES_TARGET_PORT=8793

echo.
echo ============================================================
echo   Starting...
echo     Sticky-note wall and index wall, sharing ONE login and ONE URL.
echo     Both walls' data live in their own "public-share-data" folder -
echo     separate from your desktop/wallpaper-app notes and index sets.
echo     You:          http://localhost:8794/wall   (no password)
echo     Other people: use the URLs printed below.
if "%SHARE_PUBLIC%"=="on" echo     Public:       ngrok URL printed below - works from anywhere.
echo   If Windows Firewall asks, choose "Allow access".
echo   Use the "switch wall" button in the toolbar to flip between the two
echo   walls - same login carries over, no need to sign in again.
echo   Close this window to stop everything (both servers + gateway + ngrok).
echo ============================================================
echo.

REM call node directly (not "npm run") so closing this window kills the whole
REM tree - npm's extra process layers on Windows orphan child servers/ngrok.
call node "%~dp0share-gateway\serve.mjs"

REM belt-and-suspenders (Ctrl+C path): if anything is still holding these
REM ports, drop it.
for %%P in (%GATEWAY_PORT% %NOTES_TARGET_PORT% %FILES_TARGET_PORT%) do (
  for /f "tokens=5" %%p in ('netstat -a -n -o ^| findstr ":%%P " ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
)

echo.
echo (stopped)
pause
exit /b 0

REM ---- :strlen <varname_in> <varname_out> ---------------------------
:strlen
setlocal EnableDelayedExpansion
set "s=!%~1!"
set "n=0"
:strlen_loop
if defined s (
  set "s=!s:~1!"
  set /a n+=1
  goto strlen_loop
)
endlocal & set "%~2=%n%"
goto :eof
