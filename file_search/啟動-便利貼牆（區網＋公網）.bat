@echo off
setlocal
REM ASCII-only on purpose (cp950 consoles mangle a UTF-8 .bat).
chcp 65001 >nul
title Sticky Wall - LAN + Public share mode
cd /d "%~dp0"

echo ============================================================
echo   Sticky notes wall . LAN + Public share mode
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

echo [build] building notes-web frontend ...
call npm --prefix notes-web run build
if errorlevel 1 ( echo [Error] build failed - see messages above & pause & exit /b 1 )

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

REM ---- shared password: share-config.txt (gitignored) or ask now ----
set "SHARE_TOKEN="
if exist "share-config.txt" set /p SHARE_TOKEN=<share-config.txt
if defined SHARE_TOKEN goto haspw

echo.
if "%SHARE_PUBLIC%"=="on" echo Public mode: pick a STRONG password ^(8+ chars; this is on the open internet^).
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

REM ---- public mode needs an 8+ char password ----
REM (not inside a parenthesised block: %PWLEN% must expand AFTER "call :strlen")
if not "%SHARE_PUBLIC%"=="on" goto pwok
call :strlen SHARE_TOKEN PWLEN
if %PWLEN% LSS 8 (
  echo.
  echo [Error] Public mode needs a password of at least 8 characters ^(yours: %PWLEN%^).
  echo         Edit share-config.txt ^(or delete it and run again^) to fix.
  pause
  exit /b 1
)
:pwok

set SHARE_MODE=lan
REM Remote users cannot use AI by default (spends your quota / hits your Ollama).
set SHARE_AI=off
set NODE_ENV=production
REM Different port than wallpaper-app's personal wall (8787) so both can run
REM at once. Different data file too - this wall is SEPARATE from your
REM desktop / wallpaper-app notes, never shared, never overwritten by either side.
set API_PORT=8790
if not defined STICKY_NOTES_FILE set "STICKY_NOTES_FILE=%~dp0notes-web\public-wall-data\.sticky_notes.json"

echo.
echo ============================================================
echo   Starting...
echo     This wall is SEPARATE from your desktop / wallpaper-app notes.
echo     You:          http://localhost:8790/wall   (no password)
echo     Other people: use the URLs printed below.
if "%SHARE_PUBLIC%"=="on" echo     Public:       ngrok URL printed below - works from anywhere.
echo   If Windows Firewall asks, choose "Allow access".
echo   Close this window to stop everything (server + ngrok).
echo ============================================================
echo.

REM call node directly (not "npm run") so closing this window kills the whole
REM tree - npm's extra process layers on Windows orphan the server + ngrok.
call node "%~dp0notes-web\scripts\share-serve.mjs"

REM belt-and-suspenders (Ctrl+C path): if anything is still holding the port, drop it.
for /f "tokens=5" %%p in ('netstat -a -n -o ^| findstr ":%API_PORT% " ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1

echo.
echo (stopped)
pause
exit /b 0

REM ---- :strlen <varname_in> <varname_out> ---------------------------
REM delayed expansion is local to this subroutine, so a "!" in the
REM password does not get mangled in the main script.
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
