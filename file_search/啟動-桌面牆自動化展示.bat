@echo off
setlocal
title Desktop wall automated demo

rem ---------------------------------------------------------------------------
rem  Double-click to run the automated product demo: wallpaper-app\demo\run.ps1
rem  (via launch.ps1, which prints the banner, countdown and result).
rem  Any arguments are passed through to it, e.g.
rem      this.bat -PlaySeconds 3 -NoCleanup
rem      this.bat -ImportDir "C:\Users\me\Downloads\stuff" -VideoFile "a.mp4"
rem  Set DEMO_NOWAIT=1 to skip the 5 second countdown and the final pause.
rem  NOTE: keep this file pure ASCII with CRLF line endings. Under chcp 65001
rem  cmd mis-tracks its read position in batch files containing multi-byte UTF-8
rem  text and, after an external program returns, resumes mid-line (symptom:
rem  "'o' is not recognized as an internal or external command"). Put any
rem  Chinese messages in launch.ps1 instead.
rem ---------------------------------------------------------------------------

set "LAUNCH=%~dp0wallpaper-app\demo\launch.ps1"
if not exist "%LAUNCH%" goto :missing

powershell -NoProfile -ExecutionPolicy Bypass -File "%LAUNCH%" %*
exit /b %ERRORLEVEL%

:missing
echo [ERROR] not found: %LAUNCH%
if not defined DEMO_NOWAIT pause
exit /b 1
