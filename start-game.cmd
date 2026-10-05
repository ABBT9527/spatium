@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SPATIUM

echo.
echo   ==========================================================
echo     SPATIUM  /  量形之度
echo     frozen snapshot launcher  (stable, edit-proof)
echo   ==========================================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo   [X] npm not found in PATH. Install Node.js first.
  echo.
  pause
  exit /b 1
)

echo   [1/2] building frozen snapshot into dist\ ...
call npm run build
if errorlevel 1 (
  echo.
  echo   [X] build failed - see the errors above.
  echo.
  pause
  exit /b 1
)

echo.
echo   [2/2] serving at  http://127.0.0.1:4173/
echo         (close this window to stop the server)
echo.
echo   TIP: this serves a frozen build, so later code edits
echo        will NOT break the page you have open.
echo.
call npm run preview -- --open

echo.
echo   server stopped.
pause
