@echo off
setlocal
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
  echo Jarvis is not set up yet. Run setup.bat first.
  goto end
)
if not exist .env (
  echo Missing .env - add your ELEVENLABS_API_KEY there.
  goto end
)

rem Download any new version of Jarvis first (never blocks starting if you're offline)
.venv\Scripts\python.exe scripts\update.py --quiet

rem The cloud voice client needs the ElevenLabs library
.venv\Scripts\python.exe -c "import elevenlabs, sounddevice, openwakeword" >nul 2>nul || (
  echo Installing the ElevenLabs library...
  .venv\Scripts\python.exe -m pip install "elevenlabs>=2.0"
)

set JARVIS_MODE=cloud

rem agent.bat console = no HUD, just the text console
if /i "%1"=="console" (
  .venv\Scripts\python.exe backend\voice_agent.py
  goto done
)

rem Electron downloads its own binary on install; repair it if that download failed.
if not exist ui\node_modules\electron\dist\electron.exe (
  echo Electron is not installed correctly - repairing, this downloads about 100 MB...
  if exist ui\node_modules\electron rmdir /s /q ui\node_modules\electron
  cd ui
  call npm install
  node node_modules\electron\install.js
  cd ..
)

cd ui
if exist node_modules\.bin\electron.cmd (call node_modules\.bin\electron.cmd .) else (call npm start)
cd ..

:done
echo.
echo Jarvis exited. Any error is shown above.
:end
pause
