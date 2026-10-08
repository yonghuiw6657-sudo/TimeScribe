@echo off
setlocal
set PORT=8787

set PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe
if not exist "%PS%" set PS=powershell.exe

echo Stopping the local server on port %PORT% ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr /c:":%PORT% "') do (
  if not "%%p"=="4" (
    echo   killing PID %%p
    taskkill /PID %%p /F >nul 2>&1
  )
)
if exist "%~dp0server.pid" del /q "%~dp0server.pid" >nul 2>&1
echo Done.
timeout /t 2 >nul
