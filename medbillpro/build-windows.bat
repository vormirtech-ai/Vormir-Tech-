@echo off
REM ---------------------------------------------------------------
REM  MedV - build the Windows installer (MedBillPro_Setup.exe)
REM  Run this on a Windows PC that has Node.js 18+ and internet.
REM ---------------------------------------------------------------
setlocal
cd /d "%~dp0"

echo.
echo  MedV - building the Windows installer
echo  -------------------------------------
echo.

REM Clear the "downloaded from the internet" mark on this folder, so Windows
REM does not block the files we are about to use. Harmless if already clear.
powershell -NoProfile -Command "Get-ChildItem -Recurse -File | Unblock-File" >nul 2>nul

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js was not found.
  echo  Install it from https://nodejs.org  ^(LTS version^), then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  [1/2] Installing build dependencies. This needs internet and takes a few minutes...
  call npm install
  if errorlevel 1 goto failed
) else (
  echo  [1/2] Dependencies already installed - skipping.
)

echo.
echo  [2/2] Packaging...
call npm run dist
if errorlevel 1 goto failed

echo.
echo  Done. Your installer is here:
echo      %cd%\dist\MedBillPro_Setup.exe
echo  A portable build ^(no installation needed^) is here:
echo      %cd%\dist\MedBillPro_Portable.exe
echo.
pause
exit /b 0

:failed
echo.
echo  The build failed. Scroll up for the first red error line.
echo  Most common causes:
echo    - no internet during "npm install"
echo    - Windows blocked a file  ^(see docs\WINDOWS-SECURITY.md^)
echo    - the SQLite driver needed to compile and Visual Studio Build Tools
echo      are not installed  ^(see docs\INSTALL-WINDOWS.md^)
echo.
pause
exit /b 1
