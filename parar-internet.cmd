@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\internet.ps1" -Action Disable
if errorlevel 1 pause
