@echo off
setlocal
set PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe
if not exist "%PS%" set PS=powershell.exe
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -Port 8787
exit /b %ERRORLEVEL%
