@echo off
setlocal
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
  echo Jarvis is not set up yet. Run setup.bat first.
  goto end
)
if not exist .env (
  echo Missing .env - run setup.bat, or copy .env.example to .env and add your API key.
  goto end
)

:launch
rem Download any new version of Jarvis first (never blocks starting if you're offline)
.venv\Scripts\python.exe scripts\update.py --quiet

rem Electron downloads its own binary on install; repair it if that download failed.
if not exist ui\node_modules\electron\dist\electron.exe (
  echo Electron is not installed correctly - repairing, this downloads about 100 MB...
  if exist ui\node_modules\electron rmdir /s /q ui\node_modules\electron
  cd ui
  call npm install
  node node_modules\electron\install.js
  cd ..
  if not exist ui\node_modules\electron\dist\electron.exe goto electronfail
)

rem Make sure newer libraries are present
.venv\Scripts\python.exe -c "import google.genai, spotipy, pycaw, soundcard" >nul 2>nul || (
  echo Installing new libraries...
  .venv\Scripts\python.exe -m pip install google-genai spotipy pycaw soundcard
)

if /i "%1"=="demo" set JARVIS_DEMO=1
set JARVIS_RESTARTABLE=1
cd ui
if exist node_modules\.bin\electron.cmd (call node_modules\.bin\electron.cmd .) else (call npm start)
set RC=%errorlevel%
cd ..
if "%RC%"=="42" (
  echo.
  echo Restarting Jarvis...
  goto launch
)
echo.
echo Jarvis exited. Any error is shown above.
goto end

:electronfail
echo.
echo Electron still failed to download. Common causes:
echo   - Antivirus or a firewall blocking the download: pause it briefly and run run.bat again
echo   - Unstable connection: just run run.bat again
echo   - Work/school network: try another network or a phone hotspot
:end
pause
