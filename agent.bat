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
.venv\Scripts\python.exe -c "import elevenlabs, sounddevice" >nul 2>nul || (
  echo Installing the ElevenLabs library...
  .venv\Scripts\python.exe -m pip install "elevenlabs>=2.0"
)

.venv\Scripts\python.exe backend\voice_agent.py %*
echo.
echo Jarvis exited. Any error is shown above.
:end
pause
