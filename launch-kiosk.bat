@echo off
setlocal
set "KIOSK_URL=%~1"
if "%KIOSK_URL%"=="" set "KIOSK_URL=http://localhost:5173/kiosk"

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if "%BROWSER%"=="" if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if "%BROWSER%"=="" if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if "%BROWSER%"=="" if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if "%BROWSER%"=="" if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if "%BROWSER%"=="" (
    echo Could not find Google Chrome or Microsoft Edge.
    echo Please open %KIOSK_URL% in Chrome/Edge with --kiosk mode.
    pause
    exit /b 1
)

echo Launching HelloDine Table Kiosk in locked full-screen mode...
echo URL: %KIOSK_URL%
start "" "%BROWSER%" --kiosk "%KIOSK_URL%" --no-first-run --disable-pinch --overscroll-history-navigation=0 --user-data-dir="%LocalAppData%\HelloDineKioskProfile"
endlocal
