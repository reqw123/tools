@echo off
setlocal
chcp 65001 >nul
title Desktop wall automated demo

rem ---------------------------------------------------------------------------
rem  Double-click to run the automated product demo: wallpaper-app\demo\run.ps1
rem  Any arguments are passed through to it, e.g.
rem      this.bat -PlaySeconds 3 -NoCleanup
rem      this.bat -ImportDir "C:\Users\me\Downloads\stuff" -VideoFile "a.mp4"
rem  Set DEMO_NOWAIT=1 to skip the 5 second countdown and the final pause.
rem  NOTE: keep this file UTF-8 WITHOUT BOM and CRLF line endings (cmd chokes on a BOM
rem  in the first line). Keep any non-ASCII text below the chcp line.
rem ---------------------------------------------------------------------------

set "SCRIPT=%~dp0wallpaper-app\demo\run.ps1"
if not exist "%SCRIPT%" goto :missing

echo ============================================================
echo   桌面牆 自動化展示
echo.
echo   接下來約 1 分鐘，滑鼠與鍵盤會被腳本接管，請不要碰。
echo   開始前請先關掉桌面牆（右上角 X），以及不想被截圖拍到的視窗。
echo   等 5 秒後自動開始，按任意鍵立即開始，Ctrl+C 取消。
echo ============================================================
if not defined DEMO_NOWAIT timeout /t 5 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" echo 展示完成。
if not "%RC%"=="0" echo 展示中止，結束碼 %RC%。詳見 wallpaper-app\demo\out\run.log
if not defined DEMO_NOWAIT pause
exit /b %RC%

:missing
echo [ERROR] not found: %SCRIPT%
if not defined DEMO_NOWAIT pause
exit /b 1
