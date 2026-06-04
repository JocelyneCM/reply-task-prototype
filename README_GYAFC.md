# GYAFC Formality Trainer with ROCm Support

Train a formality classification model on the Grammarly's Yahoo Answers Formality Corpus (GYAFC) using your AMD Radeon 9070 XT GPU with ROCm acceleration.

## 🚀 Quick Start

### Option 1: Native Installation (Recommended for Development)

**Windows:**
```batch
setup_windows.bat
python gyafcTrainer.py
```

**Linux/WSL2:**
```bash
chmod +x setup_linux.sh
./setup_linux.sh
python gyafcTrainer.py
```

### Option 2: Docker (Recommended for Reproducibility)

```bash
# Prepare GYAFC dataset (copy to current directory)
cp -r /path/to/GYAFC_Corpus ./

# Build and run
docker-compose up --build
```

## 📋 What's New

### Dataset
- **Source**: GYAFC Corpus (Grammarly's Yahoo Answers Formality Corpus)
- **Domains**: Entertainment & Music, Family & Relationships
- **Total Samples**: ~105,000 formality/informality pairs
- **Train/Test Split**: 80/20 (stratified)
- **Labels**: 0=Informal, 1=Formal

### Training Configuration
- **Model**: DistilBERT (efficient, fast)
- **Epochs**: 5
- **Batch Size**: 32 (adjust for VRAM constraints)
- **Learning Rate**: 2e-5
- **Metrics**: Accuracy, Precision, Recall, F1-score

### ROCm GPU Acceleration
- **Target GPU**: AMD Radeon 9070 XT
- **Framework**: PyTorch with ROCm 5.7+
- **Docker Image**: rocm/pytorch:latest
- **Deployment**: Docker Compose with GPU pass-through

## 🔧 Installation

### Prerequisites
- Python 3.10+
- ROCm 5.7+ (AMD drivers)
- 8GB+ VRAM recommended
- GYAFC_Corpus dataset

### Native Setup

1. **Run setup script**
   ```bash
   # Windows
   setup_windows.bat
   
   # Linux
   ./setup_linux.sh
   ```

2. **Verify GPU support**
   ```bash
   python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
   ```

3. **Prepare dataset**
   - Download GYAFC_Corpus
   - Place in workspace or set `GYAFC_PATH` environment variable

### Docker Setup

1. **Install Docker & Docker Compose**
   - Windows: Docker Desktop with WSL2 backend
   - Linux: Standard Docker + Docker Compose

2. **Configure ROCm GPU access** (Linux only)
   ```bash
   sudo usermod -aG render $USER
   sudo usermod -aG video $USER
   ```

3. **Build and run**
   ```bash
   docker-compose up --build
   ```

## 📊 Training

### Start Training
```bash
python gyafcTrainer.py
```

### Expected Output
```
Loading GYAFC dataset...
Loaded 105248 samples
Label distribution:
1    52624
0    52624
...
Training set size: 84198
Test set size: 21050

Starting training...
[Epoch 1/5]: 100%|████| 2631/2631 [1:23:45<00:00, 1.91s/it]
...
Saving model...
Model saved to ./formality_model
```

### Training Time
- **GPU (9070 XT with batch size 32)**: ~2-3 hours total
- **CPU**: ~12-16 hours total
- **Mixed precision**: ~1-2 hours total (add `fp16=True` to trainer args)

## 🎯 Output

After training, you'll find:
- **Model**: `./formality_model/` (PyTorch format)
  - `pytorch_model.bin` - Model weights
  - `config.json` - Model configuration
  - `tokenizer.json` - Tokenizer
  - `training_args.bin` - Training configuration

- **Logs**: Training metrics in console output

## 💾 Model Architecture

```
DistilBERT-base-uncased
├── Embeddings (768 dims)
├── 6 Transformer Layers
├── Attention Heads (12)
└── Classification Head (2 classes: formal/informal)
```

## ⚙️ Configuration

### Environment Variables
```bash
# Path to GYAFC_Corpus (default: /data/GYAFC_Corpus in Docker)
export GYAFC_PATH=/path/to/GYAFC_Corpus

# For Docker: GPU device
export HSA_OVERRIDE_GFX_VERSION=gfx1201  # 9070 XT
```

### Trainer Parameters (gyafcTrainer.py)
```python
# Adjust batch size based on VRAM
per_device_train_batch_size=32  # Reduce to 16 or 8 if OOM

# Epochs
num_train_epochs=5

# Learning rate
learning_rate=2e-5

# Test split ratio
test_size=0.2  # 20% for testing
```

## 🐛 Troubleshooting

### GPU Not Detected
```bash
# Check ROCm installation
rocm-smi

# Check PyTorch ROCm support
python -c "import torch; print(torch.version.hip)"

# Verify CUDA availability
python -c "import torch; print(torch.cuda.is_available())"
```

### Out of Memory (OOM)
```python
# In gyafcTrainer.py, reduce batch size
per_device_train_batch_size=16  # or 8

# Or enable gradient accumulation
gradient_accumulation_steps=2
```

### Docker GPU Not Found
```bash
# Verify GPU devices
ls -la /dev/dri/
ls -la /dev/kfd

# Check Docker can access GPU
docker run --rm --device /dev/kfd --device /dev/dri rocm/rocm-terminal rocm-smi
```

### Slow Training
- Verify GPU utilization with `rocm-smi` (should be 90%+)
- Check batch size isn't too small (overhead)
- Ensure no CPU bottleneck (use larger batch size)

## 📈 Performance Notes

- **Dataset**: ~105k samples, balanced (50% formal, 50% informal)
- **Model Size**: ~67M parameters
- **Expected F1**: 0.75-0.85 on test set
- **Training Accuracy**: Usually reaches 85%+ by epoch 3

## 🔗 Data Splits Explanation

The trainer uses:
- **Training data**: `Entertainment_Music/{train,tune}` + `Family_Relationships/{train,tune}`
- **Validation/Test**: 20% of training data
- **Original test set**: Available in `{domain}/test/` (not used by default)

To use original test splits, modify the trainer:
```python
# Load test set separately
def load_gyafc_test():
    # Similar to load_gyafc_data but only load 'test' split
```

## 📚 References

- [GYAFC Corpus Paper](https://github.com/grammarly/GYAFC)
- [PyTorch ROCm Documentation](https://pytorch.org/blog/pytorch-for-amd-rocm-platform/)
- [AMD ROCm Installation](https://rocmdocs.amd.com/)
- [DistilBERT Paper](https://arxiv.org/abs/1910.01108)

## 📝 License

Model: DistilBERT (Hugging Face)  
Dataset: GYAFC (Grammarly)  
Code: Your own
