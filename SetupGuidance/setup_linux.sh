#!/bin/bash
# Setup script for GYAFC Trainer with ROCm on Linux

echo "======================================"
echo "GYAFC Formality Trainer - Linux Setup"
echo "======================================"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed"
    echo "Please install Python 3.10+ first"
    exit 1
fi

echo "[1/5] Python version check - OK"
python3 --version
echo ""

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "[2/5] Creating Python virtual environment..."
    python3 -m venv venv
    echo "Virtual environment created"
else
    echo "[2/5] Virtual environment already exists"
fi

echo ""

# Activate virtual environment
echo "[3/5] Activating virtual environment..."
source venv/bin/activate

echo ""

# Install ROCm PyTorch
echo "[4/5] Installing PyTorch with ROCm support..."
echo "This may take a few minutes..."
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm5.7

echo ""

# Install other dependencies
echo "[5/5] Installing other dependencies..."
pip install -r requirements-rocm.txt

echo ""
echo "======================================"
echo "Setup complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Place GYAFC_Corpus folder in the current directory"
echo "2. Run: python gyafcTrainer.py"
echo ""
echo "To verify GPU setup:"
echo "  python -c \"import torch; print('GPU Available:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')\""
echo ""
