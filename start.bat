@echo off
title Kitchen Display System
echo ========================================
echo   Kitchen Display System - Setup
echo ========================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo FEHLER: Node.js ist nicht installiert!
  echo Bitte von https://nodejs.org herunterladen.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installiere Abhaengigkeiten...
  npm install
  if %errorlevel% neq 0 (
    echo FEHLER bei npm install.
    pause
    exit /b 1
  )
  echo.
)

echo Starte Server...
echo.
node server.js
pause
