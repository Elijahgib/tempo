@echo off
setlocal
cd /d "%~dp0"
title Tempo V0.1

echo.
echo ==========================================
echo        TEMPO V0.1 - LOCAL TEST SERVER
echo ==========================================
echo.
echo Laptop URL: http://localhost:5173
echo.
echo For iPhone, use port 5173 with one of these LAN IPv4 addresses:
ipconfig | findstr /i "IPv4"
echo.
echo Both devices must be on the same Wi-Fi for local iPhone testing.
echo Press Ctrl+C to stop Tempo.
echo.

where py >nul 2>nul
if not errorlevel 1 (
  py -m http.server 5173 --bind 0.0.0.0
  exit /b
)

where python >nul 2>nul
if not errorlevel 1 (
  python -m http.server 5173 --bind 0.0.0.0
  exit /b
)

echo ERROR: Python was not found in PATH.
pause
endlocal
