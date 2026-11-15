@echo off
title SafeStep Backend Server
echo ==========================================================
echo Starting SafeStep Backend Server...
echo Port: 8000
echo ==========================================================

REM Check if python exists
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Python detected. Launching FastAPI backend...
    cd backend
    python -m uvicorn main:app --reload --port 8000
) else (
    echo Launching Native SafeStep REST Engine...
    powershell -ExecutionPolicy Bypass -File "%~dp0run_backend.ps1"
)
pause
