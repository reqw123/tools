@echo off
setlocal
chcp 65001 >nul
title Build FileSearch.exe

rem 在 packaging\.build-venv 建一個「打包專用」的獨立虛擬環境，PyInstaller 跟要
rem 一起打包的選用套件都只裝在這裡，完全不動系統的 anaconda / 全域環境。
rem 產出：dist\FileSearch\FileSearch.exe（onedir，整個 FileSearch 資料夾一起帶走）。
rem
rem 語音轉錄（faster-whisper）刻意不打包，體積太大；打包版會自動把該功能標為
rem 不可用，需要時改用原始碼版 (python file_search.py / run_file_search.bat)。

set "PROJECT_ROOT=%~dp0.."
set "VENV=%~dp0.build-venv"
set "SPEC=%~dp0file_search.spec"

rem 找 Python：優先用環境變數 PY，其次 run_file_search.bat 裡那顆已知可用的，
rem 最後退回 PATH 上的 python。需要 Python 3.9+ 且含 tkinter。
if defined PY goto :have_py
set "PY=C:\Users\lynnc\anaconda3\python.exe"
if exist "%PY%" goto :have_py
set "PY=python"
:have_py

echo [1/4] 建立/沿用打包專用虛擬環境：%VENV%
if not exist "%VENV%\Scripts\python.exe" (
    "%PY%" -m venv "%VENV%"
    if errorlevel 1 (
        echo [ERROR] 建立 venv 失敗，請確認 "%PY%" 是可用的 Python 3。
        pause & exit /b 1
    )
)
set "VPY=%VENV%\Scripts\python.exe"

echo [2/4] 安裝 PyInstaller 與要一起打包的選用套件（只裝在這個 venv）
"%VPY%" -m pip install --upgrade pip >nul
"%VPY%" -m pip install pyinstaller pillow py7zr pypdf python-vlc tkinterdnd2 pywin32
if errorlevel 1 (
    echo [ERROR] 套件安裝失敗，請檢查網路連線。
    pause & exit /b 1
)

echo [3/4] 清掉上一次的 build/ 與 dist\FileSearch
if exist "%~dp0build" rmdir /s /q "%~dp0build"
if exist "%PROJECT_ROOT%\dist\FileSearch" rmdir /s /q "%PROJECT_ROOT%\dist\FileSearch"

echo [4/4] 執行 PyInstaller
cd /d "%PROJECT_ROOT%"
"%VPY%" -m PyInstaller "%SPEC%" --noconfirm --distpath "%PROJECT_ROOT%\dist" --workpath "%~dp0build"
if errorlevel 1 (
    echo.
    echo [ERROR] 打包失敗，往上捲看 PyInstaller 的錯誤訊息。
    pause & exit /b 1
)

echo.
echo ========================================================
echo  完成： %PROJECT_ROOT%\dist\FileSearch\FileSearch.exe
echo.
echo  發佈時整個 dist\FileSearch\ 資料夾一起帶走。第一次執行
echo  會在 FileSearch.exe 旁邊建立 indexes\ 存放索引與設定。
echo ========================================================
echo.
pause
