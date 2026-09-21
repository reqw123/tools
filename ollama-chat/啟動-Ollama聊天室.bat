@echo off
REM ASCII-only on purpose (cp950 consoles mangle a UTF-8 .bat with Chinese
REM text in it - see file_search's launchers for the same fix).
setlocal
title Ollama Chat - LAN + Public share mode
cd /d "%~dp0"

echo ============================================================
echo   Ollama Chat
echo   LAN always on. Optionally also open to the internet via ngrok.
echo ============================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [Error] Python not found on PATH. Install it first: https://www.python.org/
  pause
  exit /b 1
)

echo Checking dependencies...
python -m pip install -r requirements.txt -q
if errorlevel 1 (
  echo [Error] pip install failed - see messages above.
  pause
  exit /b 1
)

REM ---- desktop shortcut: rebuilt every run so it always points at THIS .bat
REM      at its current location. A failure here does not stop startup.
REM      PROJ_ROOT must NOT keep its trailing backslash: "%~dp0" quoted with a
REM      trailing "\" right before the closing quote gets parsed by
REM      powershell.exe's argv handling as an escaped quote, silently
REM      swallowing the next argument (-BatPath).
set "PROJ_ROOT=%~dp0"
if "%PROJ_ROOT:~-1%"=="\" set "PROJ_ROOT=%PROJ_ROOT:~0,-1%"
echo [setup] ensuring desktop shortcut ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-shortcut.ps1" -ProjectRoot "%PROJ_ROOT%" -BatPath "%~f0"

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

REM ---- shared password: share-config.txt (gitignored-style, plain local file) ----
set "SHARE_TOKEN="
if exist "share-config.txt" set /p SHARE_TOKEN=<share-config.txt
if defined SHARE_TOKEN goto haspw

echo.
if "%SHARE_PUBLIC%"=="on" echo Public mode: pick a STRONG password ^(8+ chars; this is on the open internet^).
set /p SHARE_TOKEN=Set a shared password (others - not you - type this to get in):
if not defined SHARE_TOKEN ( echo No password entered - aborting. & pause & exit /b 1 )
set /p SAVEPW=Save it to share-config.txt so you are not asked next time? (y/N):
if /i "%SAVEPW%"=="y" (
  echo %SHARE_TOKEN%>share-config.txt
  echo Saved to share-config.txt.
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
  echo         Edit share-config.txt ^(or delete it and run again^) to fix.
  pause
  exit /b 1
)
:pwok

set SHARE_MODE=lan

echo.
echo ============================================================
echo   Starting...
echo     You:          http://localhost:8795/ollama   (no password)
echo     Other people: use the URLs printed below.
if "%SHARE_PUBLIC%"=="on" echo     Public:       ngrok URL printed below - works from anywhere.
echo   If Windows Firewall asks, choose "Allow access".
echo   Anyone reaching this except you (LAN or public) can run prompts on
echo   your local Ollama - that is the point, but know what you're sharing.
echo   Close this window to stop everything (server + ngrok).
echo ============================================================
echo.

python server.py

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
