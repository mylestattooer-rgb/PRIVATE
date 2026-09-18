@echo off
REM Double-click to rebuild the catalogue and open it (Windows).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node isn't installed, and the catalogue needs it to build.
  echo   Install it from https://nodejs.org then run this again.
  echo.
  pause
  exit /b 1
)
node build.mjs || (
  echo.
  echo   The build stopped on an error - the message above says why.
  pause
  exit /b 1
)
start "" index.html
