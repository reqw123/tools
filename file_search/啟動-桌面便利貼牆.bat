@echo off
setlocal
title Wallpaper App
chcp 65001 >nul

rem Project root = the folder this .bat lives in. Strip the trailing backslash
rem before passing it on.
set "PROJ_ROOT=%~dp0"
if "%PROJ_ROOT:~-1%"=="\" set "PROJ_ROOT=%PROJ_ROOT:~0,-1%"

if "%~1"=="/silent" goto :main

rem Decide up front whether this run actually needs a visible console: only
rem when setup (npm install / web build) still has to happen. Once everything
rem is already installed and built, relaunch completely hidden instead --
rem there's an in-app close button now (top-right corner, either wall), so
rem this console window doesn't need to hang around like it used to.
if not exist "%PROJ_ROOT%\wallpaper-app\node_modules\electron\dist\electron.exe" goto :main
if not exist "%PROJ_ROOT%\notes-web\node_modules\" goto :main
if not exist "%PROJ_ROOT%\files-web\node_modules\" goto :main
if not exist "%PROJ_ROOT%\notes-web\dist\" goto :main
if not exist "%PROJ_ROOT%\files-web\dist\" goto :main
start "" wscript.exe "%~dp0run-hidden.vbs" "%~f0" /silent
exit /b 0

:main
set "SILENT=0"
if "%~1"=="/silent" set "SILENT=1"
set "SETUP_LOG=%TEMP%\wallpaper-app-setup.log"

cd /d "%PROJ_ROOT%\wallpaper-app"

if "%SILENT%"=="0" (
  echo ============================================================
  echo   Wallpaper App  -  sticky notes / file index as wallpaper
  echo   Hotkeys: Shift+Z mode  Shift+X show/hide
  echo            Shift+C switch wall  Shift+V settings
  echo   ^(There's also a close button, top-right on either wall.^)
  echo ============================================================
  echo.
)

where node >nul 2>nul
if errorlevel 1 (
  call :fail "Node.js not found. Install the LTS from https://nodejs.org/"
  exit /b 1
)

rem ---- dependencies: three projects, install whichever is missing ----------
rem      (idempotent; each check is skipped once its node_modules is present)
if exist "node_modules\electron\dist\electron.exe" goto have_electron
if "%SILENT%"=="0" echo [setup] installing wallpaper-app deps ^(first run, electron ~100MB^) ...
call npm install >"%SETUP_LOG%" 2>&1
if %errorlevel% neq 0 goto installfail
:have_electron

if exist "..\notes-web\node_modules\" goto sticky_ok
if "%SILENT%"=="0" echo [setup] installing notes-web deps ...
call npm --prefix ..\notes-web install >>"%SETUP_LOG%" 2>&1
if %errorlevel% neq 0 goto installfail
:sticky_ok

if exist "..\files-web\node_modules\" goto index_ok
if "%SILENT%"=="0" echo [setup] installing files-web deps ...
call npm --prefix ..\files-web install >>"%SETUP_LOG%" 2>&1
if %errorlevel% neq 0 goto installfail
:index_ok

rem ---- web dist folders: (re)build whenever the frontend source is newer
rem      than the built dist, or a dist is missing. rebuild-if-stale.ps1
rem      compares notes-web / files-web  src\ + index.html + vite/tsconfig
rem      /tailwind/postcss/package.json  against their dist\index.html and
rem      runs `npm run build` only for the one(s) that changed. Keeps the
rem      wallpaper in sync with edits without a manual `npm run build:webs`.
rem      (server\ / ai_bridge.py changes don't touch dist -- those just need
rem       the tray's "clear cache & reload".)
if "%SILENT%"=="0" echo [build] checking the two web dist folders are up to date ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJ_ROOT%\wallpaper-app\rebuild-if-stale.ps1" -ProjectRoot "%PROJ_ROOT%" >>"%SETUP_LOG%" 2>&1
if %errorlevel% neq 0 goto buildfail
:webs_built

rem ---- desktop shortcut: rebuilt every run so it always points at THIS .bat
rem      at its current location (moved the project / new PC? just run again).
rem      Icon source: wallpaper-app\assets\shortcut-icon.jpg -- swap that image
rem      and run again to change it. A failure here does not stop startup.
if "%SILENT%"=="0" echo [setup] ensuring desktop shortcut ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJ_ROOT%\wallpaper-app\make-shortcut.ps1" -ProjectRoot "%PROJ_ROOT%" -BatPath "%~f0" >>"%SETUP_LOG%" 2>&1

if "%SILENT%"=="1" (
  call npm start >>"%SETUP_LOG%" 2>&1
  exit /b 0
)

echo.
echo Starting wallpaper app ...
echo (Everything is set up now -- future launches will start silently,
echo  no console window. Close the app from its top-right button or the
echo  tray icon, not by closing this window.)
call npm start
echo.
echo [wallpaper app exited]
pause
exit /b 0

:installfail
call :fail "npm install failed. Details: %SETUP_LOG%"
exit /b 1

:buildfail
call :fail "Web build failed. Details: %SETUP_LOG%"
exit /b 1

:fail
mshta "javascript:new ActiveXObject('WScript.Shell').Popup('%~1',0,'Wallpaper App - Startup Failed',16);close();"
exit /b 1
