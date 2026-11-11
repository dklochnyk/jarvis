@echo off
cd /d "%~dp0"
.venv\Scripts\python.exe scripts\rollback.py
pause
