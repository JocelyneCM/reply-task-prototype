# Dockerfile for GYAFC Formality Classifier with ROCm support (AMD 9070 XT)
FROM rocm/pytorch:latest

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements
COPY requirements-rocm.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements-rocm.txt

# Copy application files
COPY gyafcTrainer.py .
COPY app.js .
COPY index.html .
COPY style.css .

# Create directory for model output
RUN mkdir -p /app/formality_model /data

# Set environment variable for GYAFC dataset path
ENV GYAFC_PATH=/data/GYAFC_Corpus

# Expose port for Flask app (if needed)
EXPOSE 5000

# Default command runs the trainer
CMD ["python", "gyafcTrainer.py"]
