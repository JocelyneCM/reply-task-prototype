# Setup script for GYAFC Trainer with ROCm on Windows (PowerShell)

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "GYAFC Formality Trainer - Windows Setup" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check if Python is installed
try {
    $pythonVersion = python --version 2>&1
    Write-Host "[1/5] Python version check - OK" -ForegroundColor Green
    Write-Host "      $pythonVersion"
} catch {
    Write-Host "[1/5] ERROR: Python is not installed or not in PATH" -ForegroundColor Red
    Write-Host "      Please install Python 3.10+ from python.org" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Create virtual environment
$venvPath = "venv"
if (-not (Test-Path $venvPath)) {
    Write-Host "[2/5] Creating Python virtual environment..." -ForegroundColor Cyan
    python -m venv venv
    Write-Host "      Virtual environment created" -ForegroundColor Green
} else {
    Write-Host "[2/5] Virtual environment already exists" -ForegroundColor Yellow
}

Write-Host ""

# Activate virtual environment
Write-Host "[3/5] Activating virtual environment..." -ForegroundColor Cyan
& ".\venv\Scripts\Activate.ps1"
Write-Host "      Virtual environment activated" -ForegroundColor Green

Write-Host ""

# Install ROCm PyTorch
Write-Host "[4/5] Installing PyTorch with ROCm support..." -ForegroundColor Cyan
Write-Host "      This may take several minutes..." -ForegroundColor Yellow
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm5.7

if ($LASTEXITCODE -ne 0) {
    Write-Host "      ERROR: Failed to install PyTorch" -ForegroundColor Red
    exit 1
}
Write-Host "      PyTorch installed successfully" -ForegroundColor Green

Write-Host ""

# Install other dependencies
Write-Host "[5/5] Installing other dependencies..." -ForegroundColor Cyan
pip install -r requirements-rocm.txt

if ($LASTEXITCODE -ne 0) {
    Write-Host "      ERROR: Failed to install dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "      Dependencies installed successfully" -ForegroundColor Green

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Place GYAFC_Corpus folder in the current directory or set GYAFC_PATH environment variable" -ForegroundColor White
Write-Host "2. Run: python gyafcTrainer.py" -ForegroundColor White
Write-Host ""
Write-Host "To verify GPU setup:" -ForegroundColor Yellow
Write-Host "  python -c \"import torch; print('GPU Available:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')\"" -ForegroundColor Gray
Write-Host ""
