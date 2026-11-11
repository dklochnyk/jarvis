@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run setup.bat first.
  goto end
)
.venv\Scripts\python.exe -c "import spotipy" >nul 2>nul || .venv\Scripts\python.exe -m pip install spotipy
.venv\Scripts\python.exe scripts\spotify_login.py
:end
pause
