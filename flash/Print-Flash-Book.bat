@echo off
REM Double-click to rebuild the flash book and open it ready to print.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node isn't installed, and the book needs it to build.
  echo   Get it from https://nodejs.org then run this again.
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
echo.
echo   Opening the flash book. Click the black "Print all designs" button at the top.
echo   In the print dialog: choose your paper size and set Scale to 100%%.
echo.
start "" sheets.html
