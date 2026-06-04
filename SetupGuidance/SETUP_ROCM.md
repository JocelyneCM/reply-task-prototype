# Setup Guide: GYAFC Trainer with ROCm (AMD 9070 XT)

## Option 1: Native Installation (Windows/Linux)

### Prerequisites
- AMD Radeon 9070 XT GPU
- ROCm installed (version 5.7 or later)
- Python 3.10+

### Installation Steps

1. **Install ROCm**
   - Windows: Download from [AMD ROCm Windows releases](https://rocmdocs.amd.com/en/docs-5.7.0/deploy/windows/index.html)
   - Linux: Follow [ROCm Linux installation guide](https://rocmdocs.amd.com/en/docs-5.7.0/deploy/linux/index.html)

2. **Create Python virtual environment**
   ```bash
   python -m venv venv
   # Windows
   venv\Scripts\activate
   # Linux/Mac
   source venv/bin/activate
   ```

3. **Install PyTorch with ROCm support**
   ```bash
   pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm5.7
   ```

4. **Install other dependencies**
   ```bash
   pip install -r requirements-rocm.txt
   ```

5. **Verify GPU detection**
   ```bash
   python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
   ```

6. **Prepare dataset**
   - Copy GYAFC_Corpus folder to your workspace or set `GYAFC_PATH` environment variable
   - Default: `GYAFC_PATH=/path/to/GYAFC_Corpus`

7. **Run trainer**
   ```bash
   python gyafcTrainer.py
   ```

## Option 2: Docker (Recommended for Reproducibility)

### Prerequisites
- Docker Engine
- Docker Compose
- ROCm Docker support configured

### Installation Steps

1. **Enable ROCm GPU support in Docker** (Linux)
   ```bash
   sudo usermod -aG docker $USER
   sudo usermod -aG render $USER
   ```

2. **Prepare directories**
   ```bash
   # Copy GYAFC_Corpus to workspace
   cp -r /path/to/GYAFC_Corpus ./
   ```

3. **Build and run container**
   ```bash
   # Build image
   docker build -t gyafc_trainer:rocm .
   
   # Or use docker-compose (automatically builds)
   docker-compose up --build
   ```

4. **Alternative: Run specific command in container**
   ```bash
   docker run --rm \
     --device /dev/kfd \
     --device /dev/dri \
     -v $(pwd)/GYAFC_Corpus:/data/GYAFC_Corpus:ro \
     -v $(pwd)/formality_model:/app/formality_model \
     -e HSA_OVERRIDE_GFX_VERSION=gfx1201 \
     gyafc_trainer:rocm \
     python gyafcTrainer.py
   ```

## Windows-Specific Notes

### Native Installation
- Install ROCm from AMD's official Windows releases
- Set environment variable: `set GYAFC_PATH=C:\path\to\GYAFC_Corpus`
- Run trainer: `python gyafcTrainer.py`

### Docker Desktop with WSL2
- Enable WSL2 backend for Docker Desktop
- Configure ROCm in WSL2 Linux environment
- Use docker-compose from WSL2 terminal

## Configuration

### Environment Variables
- `GYAFC_PATH`: Path to GYAFC_Corpus directory (default: `/data/GYAFC_Corpus`)
- `HSA_OVERRIDE_GFX_VERSION`: GPU architecture override (gfx1201 for 9070 XT)

### Trainer Parameters (in gyafcTrainer.py)
- `num_train_epochs`: Default 5 epochs
- `per_device_train_batch_size`: 32 (adjust based on VRAM)
- `learning_rate`: 2e-5
- `test_size`: 0.2 (80/20 train/test split)

## Troubleshooting

### GPU Not Detected
```bash
# Check ROCm installation
rocm-smi

# Verify PyTorch ROCm support
python -c "import torch; print(torch.version.hip); print(torch.cuda.is_available())"
```

### Out of Memory (OOM)
- Reduce `per_device_train_batch_size` in gyafcTrainer.py
- Use gradient accumulation by adding `gradient_accumulation_steps=2`

### Slow Training
- Verify GPU is being used (check GPU utilization with `rocm-smi`)
- Check batch size isn't too large for GPU VRAM
- Consider using mixed precision: add `fp16=True` to TrainingArguments

## Performance Notes

- GYAFC dataset: ~105k training samples (Entertainment_Music + Family_Relationships train+tune)
- Model: DistilBERT (efficient, good for this task)
- Estimated training time: 2-4 hours on 9070 XT with batch size 32
- Expected final F1 score: 0.75-0.85 on test set

## Data Splits

The trainer uses:
- **Training**: Entertainment_Music/train + Entertainment_Music/tune + Family_Relationships/train + Family_Relationships/tune
- **Testing**: 20% random split from training data (for validation during training)
- **Labels**: 0 = informal, 1 = formal

To evaluate on the original test split, modify the trainer to load from `test/` directories separately.
