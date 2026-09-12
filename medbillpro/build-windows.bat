@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title MedV - build the Windows installer

echo.
echo  ==========================================================
echo    MedV - building the Windows installer
echo  ==========================================================
echo.

rem ----------------------------------------------------------------
rem  1. Is the whole application here, or only this one file?
rem     Double-clicking a file inside a ZIP window makes Windows
rem     unpack that ONE file to a temp folder - nothing else.
rem ----------------------------------------------------------------
if not exist "package.json"     goto not_extracted
if not exist "src\main\main.js" goto not_extracted

rem ----------------------------------------------------------------
rem  2. Never build inside a temporary folder: Windows deletes it,
rem     and the installer would disappear with it.
rem ----------------------------------------------------------------
echo "%~dp0"| findstr /I /L /C:"\Temp\" >nul
if not errorlevel 1 goto in_temp

rem ----------------------------------------------------------------
rem  3. Node.js
rem ----------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto no_node

for /f "delims=" %%v in ('node --version 2^>nul') do set "NODEVER=%%v"
echo   Node.js %NODEVER%
echo   Folder : %cd%
echo.

rem Clear the "downloaded from the internet" mark. Harmless if already clear.
powershell -NoProfile -Command "Get-ChildItem -Recurse -File | Unblock-File" >nul 2>nul

echo   [1/2] Installing build dependencies.
echo         This needs internet and takes 5-15 minutes the first time.
echo.
call npm install || goto npm_failed

echo.
echo   [2/2] Packaging the installer.
echo.
call npm run dist || goto npm_failed

rem ----------------------------------------------------------------
rem  4. Only claim success if the installer is actually on disk.
rem ----------------------------------------------------------------
if not exist "dist\MedBillPro_Setup.exe" goto no_output

echo.
echo  ==========================================================
echo    Build finished.
echo  ==========================================================
echo.
echo    Installer : %cd%\dist\MedBillPro_Setup.exe
if exist "dist\MedBillPro_Portable.exe" echo    Portable  : %cd%\dist\MedBillPro_Portable.exe
echo.
echo    Copy the installer to the shop computer and run it.
echo    Windows will warn that it is not code-signed - see
echo    docs\WINDOWS-SECURITY.md for every dialog and its fix.
echo.
pause
exit /b 0

rem ================================================================
:not_extracted
echo  ----------------------------------------------------------
echo    STOP - the application files are not in this folder.
echo  ----------------------------------------------------------
echo.
echo    You almost certainly ran this file straight out of the ZIP
echo    window. Windows unpacks only the file you double-click into
echo    a temporary folder, so package.json and src\ were left behind
echo    inside the ZIP.
echo.
echo    Do this instead:
echo      1. Right-click  MedV_MedBillPro_v1.0.0.zip
echo      2. Properties -^> tick "Unblock" -^> OK
echo      3. Right-click it again -^> "Extract All..."
echo      4. Extract to a short path such as   C:\MedV
echo      5. Open  C:\MedV\MedV  and run build-windows.bat from there
echo.
echo    This folder:
echo      %cd%
echo.
pause
exit /b 1

rem ================================================================
:in_temp
echo  ----------------------------------------------------------
echo    STOP - this is a temporary folder.
echo  ----------------------------------------------------------
echo.
echo    Windows deletes this folder on its own, which would take the
echo    installer with it. The ZIP was opened rather than extracted.
echo.
echo    Right-click the ZIP -^> "Extract All..." -^> extract to a real
echo    folder such as  C:\MedV  and run build-windows.bat from there.
echo.
echo    This folder:
echo      %cd%
echo.
pause
exit /b 1

rem ================================================================
:no_node
echo  ----------------------------------------------------------
echo    Node.js was not found.
echo  ----------------------------------------------------------
echo.
echo    Install the LTS version from  https://nodejs.org
echo    (accept every default), then CLOSE this window, open the
echo    folder again and run build-windows.bat once more.
echo.
echo    A window opened before installing Node.js will not see it.
echo.
pause
exit /b 1

rem ================================================================
:npm_failed
echo.
echo  ----------------------------------------------------------
echo    The build did not finish. Nothing was installed.
echo  ----------------------------------------------------------
echo.
echo    Scroll up to the FIRST "npm error" line - that one explains it.
echo    The usual causes:
echo.
echo      * No internet during "npm install".
echo      * Run from inside the ZIP, so package.json is missing
echo        (extract the ZIP first - see docs\WINDOWS-SECURITY.md).
echo      * The SQLite driver had to compile and Visual Studio Build
echo        Tools are not installed - install it with the
echo        "Desktop development with C++" workload, then try again.
echo      * Windows or antivirus blocked a file
echo        (see docs\WINDOWS-SECURITY.md).
echo.
echo    Folder: %cd%
echo.
pause
exit /b 1

rem ================================================================
:no_output
echo.
echo  ----------------------------------------------------------
echo    The packaging step reported success but produced no
echo    installer, so something was blocked or removed.
echo  ----------------------------------------------------------
echo.
echo    Expected: %cd%\dist\MedBillPro_Setup.exe
echo.
echo    Check your antivirus quarantine, then see
echo    docs\WINDOWS-SECURITY.md
echo.
pause
exit /b 1
