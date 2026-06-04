@echo off
REM Setup script for GYAFC Trainer with ROCm on Windows

echo ======================================
echo GYAFC Formality Trainer - Windows Setup
echo ======================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not in PATH
    echo Please install Python 3.10+ from python.org
    exit /b 1
)

echo [1/5] Python version check - OK
echo.

REM Create virtual environment
if not exist "venv" (
    echo [2/5] Creating Python virtual environment...
    python -m venv venv
    echo Virtual environment created
) else (
    echo [2/5] Virtual environment already exists
)

echo.

REM Activate virtual environment
echo [3/5] Activating virtual environment...
call venv\Scripts\activate.bat

echo.

REM Install ROCm PyTorch
echo [4/5] Installing PyTorch with ROCm support...
echo This may take a few minutes...
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm5.7

echo.

REM Install other dependencies
echo [5/5] Installing other dependencies...
pip install -r requirements-rocm.txt

echo.
echo ======================================
echo Setup complete!
echo ======================================
echo.
echo Next steps:
echo 1. Place GYAFC_Corpus folder in the current directory or set GYAFC_PATH environment variable
echo 2. Run: python gyafcTrainer.py
echo.
echo To verify GPU setup:
echo   python -c "import torch; print('GPU Available:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
echo.
pause
