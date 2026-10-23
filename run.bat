@echo off
setlocal

where python >nul 2>nul
if errorlevel 1 (
    echo Python is not installed or not on PATH.
    echo Install Python 3.11+ from https://www.python.org/downloads/windows/
    pause
    exit /b 1
)

if not exist .venv (
    echo Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

if not exist .env (
    copy .env.example .env
    echo Created .env from .env.example.
)

echo Starting VIVA backend...
uvicorn app.main:app --host 127.0.0.1 --port 8000
