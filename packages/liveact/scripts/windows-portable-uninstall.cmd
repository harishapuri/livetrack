@echo off
REM LiveTrack portable cleanup (companion to LiveTrack-Uninstall-Portable-*.exe).
REM Double-click the .exe for a confirm dialog, or run this .cmd from an elevated-or-user shell.
setlocal EnableExtensions

echo.
echo LiveTrack portable uninstall
echo ---------------------------
echo This quits LiveTrack, deletes LiveTrack-Portable-*.exe next to this script,
echo and removes Projects\coact, Documents\Coact, .coact, and AppData\LiveTrack.
echo.
choice /C YN /M "Continue"
if errorlevel 2 goto :eof
if errorlevel 1 goto RUN
goto :eof

:RUN
echo Stopping LiveTrack...
taskkill /F /IM LiveTrack.exe /T >nul 2>&1

echo Removing portable exe beside this script...
for %%F in ("%~dp0LiveTrack-Portable-*.exe") do (
  echo   deleting %%~nxF
  del /F /Q "%%~fF" >nul 2>&1
)

if exist "%~dp0data" rd /S /Q "%~dp0data"
if exist "%~dp0LiveTrack" rd /S /Q "%~dp0LiveTrack"

echo Removing user data folders...
if exist "%USERPROFILE%\Projects\coact" rd /S /Q "%USERPROFILE%\Projects\coact"
if exist "%USERPROFILE%\Documents\Coact" rd /S /Q "%USERPROFILE%\Documents\Coact"
if exist "%USERPROFILE%\.coact" rd /S /Q "%USERPROFILE%\.coact"
if exist "%APPDATA%\LiveTrack" rd /S /Q "%APPDATA%\LiveTrack"
if exist "%LOCALAPPDATA%\LiveTrack" rd /S /Q "%LOCALAPPDATA%\LiveTrack"

if exist "%USERPROFILE%\Desktop\LiveTrack.lnk" del /F /Q "%USERPROFILE%\Desktop\LiveTrack.lnk" >nul 2>&1
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\LiveTrack.lnk" del /F /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\LiveTrack.lnk" >nul 2>&1
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\LiveTrack" rd /S /Q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\LiveTrack"

echo Done.
pause
