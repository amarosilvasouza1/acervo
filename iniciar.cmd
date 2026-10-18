@echo off
cd /d "%~dp0"
start "Acervo - servidor" cmd /c "node server.js"
timeout /t 2 >nul
start "" http://127.0.0.1:4310
