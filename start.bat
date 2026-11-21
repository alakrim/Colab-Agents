@echo off
cd /d "%~dp0"
echo.
echo ==================================================
echo   Agent Company OS - One-Command Launcher
echo ==================================================
if not exist "server\node_modules" call npm run install:all
if not exist "client\node_modules" call npm run install:all
if not exist "server\dist" call npm run build
if not exist "client\dist" call npm run build
echo.
echo Starting Agent Company OS at http://localhost:3001
echo Open http://localhost:3001 in your browser and click "Connect AI".
echo.
npm start
