@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run setup.bat first.
  goto end
)
.venv\Scripts\python.exe scripts\update.py
:end
pause
