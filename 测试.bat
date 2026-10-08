@echo off
setlocal
set SCRIPT_DIR=%~dp0

echo Running all tests for the time tracker app ...
echo.
node "%SCRIPT_DIR%tests\run-all.mjs" %*
set CODE=%ERRORLEVEL%
echo.
if "%CODE%"=="0" (
  echo ALL TESTS PASSED
) else (
  echo TESTS FAILED with exit code %CODE%
)
echo.
pause
exit /b %CODE%
