@echo off
setlocal
cd /d "%~dp0.."
node "BALTO_CONFIG\run.cjs" build all
if errorlevel 1 pause
