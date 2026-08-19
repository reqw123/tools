@echo off
setlocal
chcp 65001 >nul
title File Search

rem This tool only uses the Python standard library (tkinter/os/re/subprocess/
rem pathlib/shutil) -- any Python 3 with tkinter works. Pointing at this specific
rem interpreter just because it is already confirmed working on this machine.
set "PY=C:\Users\homec\anaconda3\envs\yolo_new\python.exe"
set "SCRIPT_DIR=%~dp0"
set "SCRIPT=%SCRIPT_DIR%file_search.py"
set "PYTHONIOENCODING=utf-8"

if not exist "%PY%" (
    echo [ERROR] Python not found at:
    echo   %PY%
    echo Edit the PY variable in this file to point at a Python 3 install with tkinter.
    pause
    exit /b 1
)

if not exist "%SCRIPT%" (
    echo [ERROR] file_search.py not found:
    echo   %SCRIPT%
    echo This batch file must sit in the same folder as file_search.py.
    pause
    exit /b 1
)

cd /d "%SCRIPT_DIR%"
"%PY%" -X utf8 "%SCRIPT%"

if errorlevel 1 (
    echo.
    echo [file_search.py exited with a non-zero code -- scroll up for details]
    pause
)
