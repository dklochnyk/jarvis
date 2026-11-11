@echo off
setlocal
cd /d "%~dp0"
echo === Jarvis setup ===

rem Prefer a Python version that all the audio/AI packages support (3.12, 3.11, 3.10).
set "PY="
for %%V in (3.12 3.11 3.10) do (
  if not defined PY (
    py -%%V -c "import struct,sys;sys.exit(0 if struct.calcsize('P')==8 else 1)" >nul 2>nul && set "PY=py -%%V"
  )
)
if not defined PY goto wrongpython
%PY% --version

where node >nul 2>nul || goto nonode
where npm >nul 2>nul || goto nonode

if not exist .venv\Scripts\python.exe (
  echo Creating virtual environment...
  %PY% -m venv .venv
  if errorlevel 1 goto fail
)
call .venv\Scripts\activate
if errorlevel 1 goto fail

echo Installing Python packages (a few minutes)...
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 goto pipfail

echo Downloading models...
python scripts\download_assets.py
if errorlevel 1 goto fail

if not exist .env copy .env.example .env >nul

echo Installing HUD (Electron)...
cd ui
call npm install
if errorlevel 1 goto fail
rem Newer npm blocks install scripts, so fetch Electron's program file ourselves.
if not exist node_modules\electron\dist\electron.exe (
  echo Downloading Electron, about 100 MB...
  node node_modules\electron\install.js
)
cd ..

echo.
echo === Setup complete ===
echo Next: open .env in Notepad, paste your GEMINI_API_KEY (or Anthropic key), save, then run run.bat
pause
exit /b 0

:wrongpython
echo.
echo No suitable Python found. Jarvis needs 64-bit Python 3.12 (3.10 or 3.11 also work).
echo Newer versions such as 3.13/3.14 are missing packages it depends on.
echo.
echo 1. Download "Python 3.12" (Windows installer 64-bit) from python.org/downloads/windows
echo 2. Tick "Add Python to PATH" and "py launcher" in the installer
echo 3. Run setup.bat again
goto end
:nonode
echo.
echo Node.js was not found. Install the LTS version from nodejs.org, then reopen this window.
goto end
:pipfail
echo.
echo Package install failed. Removing the half-built environment so the next run starts clean.
if exist .venv rmdir /s /q .venv
echo If the error mentions piper-tts, open requirements.txt, delete the line "piper-tts>=1.3",
echo save, and run setup.bat again (Jarvis will use the Windows voice instead).
goto end
:fail
echo.
echo Setup failed - see the error above.
:end
pause
exit /b 1
