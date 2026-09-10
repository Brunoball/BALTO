@echo off
setlocal
cd /d "%~dp0.."
echo.
echo ==========================================
echo   BALTO - INSTALAR CONFIG CENTRAL
echo ==========================================
echo.
node "BALTO_CONFIG\install.cjs"
if errorlevel 1 (
  echo.
  echo ERROR: no se pudo instalar la configuracion central.
  pause
  exit /b 1
)
echo.
pause
