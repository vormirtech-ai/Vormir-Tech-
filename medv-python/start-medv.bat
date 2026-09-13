@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title MedV - Pharmacy Management

echo.
echo   ==========================================================
echo     MedV - starting up
echo   ==========================================================
echo.

rem ----------------------------------------------------------------
rem  1. Are the program files actually here?
rem     (Double-clicking inside a ZIP window copies only this file.)
rem ----------------------------------------------------------------
if not exist "medv\__main__.py" goto not_extracted

rem ----------------------------------------------------------------
rem  2. Find Python. "py" is the launcher installed with Python on
rem     Windows; it avoids the Microsoft Store stub that "python"
rem     can trigger when Python is missing.
rem ----------------------------------------------------------------
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)" >nul 2>nul && set "PY=py -3"
if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)" >nul 2>nul && set "PY=python"
)
if not defined PY goto no_python

echo   Using: %PY%
echo   Your data stays on this computer. No internet needed.
echo.
echo   MedV will open in your browser in a moment.
echo   KEEP THIS WINDOW OPEN while you work - closing it stops MedV.
echo.

%PY% -m medv %*
if errorlevel 1 goto failed
exit /b 0

rem ================================================================
:not_extracted
echo   ----------------------------------------------------------
echo     STOP - the program files are not in this folder.
echo   ----------------------------------------------------------
echo.
echo     You probably ran this file straight out of the ZIP window.
echo     Windows only unpacks the one file you double-click.
echo.
echo     Do this instead:
echo       1. Right-click the ZIP -^> Properties -^> tick "Unblock" -^> OK
echo       2. Right-click it again -^> "Extract All..."
echo       3. Extract to a short path such as   C:\MedV
echo       4. Open that folder and run start-medv.bat from there
echo.
echo     This folder: %cd%
echo.
pause
exit /b 1

rem ================================================================
:no_python
echo   ----------------------------------------------------------
echo     Python 3.9 or newer was not found.
echo   ----------------------------------------------------------
echo.
echo     MedV needs Python. It is free, takes two minutes, and you
echo     only ever do this once:
echo.
echo       1. Go to        https://www.python.org/downloads/
echo       2. Download the latest Windows installer
echo       3. IMPORTANT: on the first screen, tick
echo               "Add python.exe to PATH"
echo          then click "Install Now"
echo       4. Close this window, open the folder again and run
echo          start-medv.bat
echo.
echo     Nothing else needs installing - MedV uses only what comes
echo     with Python.
echo.
pause
exit /b 1

rem ================================================================
:failed
echo.
echo   ----------------------------------------------------------
echo     MedV stopped with an error.
echo   ----------------------------------------------------------
echo.
echo     The message above explains it. Common causes:
echo       * MedV is already running in another window
echo       * your antivirus blocked the folder
echo.
echo     Your data is safe in:
echo       %%APPDATA%%\MedBillPro\data\medbill.db
echo.
pause
exit /b 1
