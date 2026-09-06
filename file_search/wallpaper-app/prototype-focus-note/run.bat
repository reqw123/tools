@echo off
rem PROTOTYPE launcher — throwaway. Borrows wallpaper-app's already-installed
rem electron, no separate npm install needed.
cd /d "%~dp0"
"..\node_modules\.bin\electron.cmd" main.js
