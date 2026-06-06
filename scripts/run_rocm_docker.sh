#!/usr/bin/env bash
set -euo pipefail

# Build and run the ROCm Docker image for training. Usage:
# ./scripts/run_rocm_docker.sh [BASE_IMAGE]
# If BASE_IMAGE is not provided, the script uses the default ARG in Dockerfile.rocm.

IMAGE_NAME=gyafc-rocm:latest
BASE_IMAGE=${1:-}

if [ -n "$BASE_IMAGE" ]; then
  echo "Building image with BASE_IMAGE=$BASE_IMAGE"
  docker build --build-arg BASE_IMAGE="$BASE_IMAGE" -t $IMAGE_NAME -f Dockerfile.rocm .
else
  echo "Building image with default BASE_IMAGE from Dockerfile.rocm"
  docker build -t $IMAGE_NAME -f Dockerfile.rocm .
fi

echo "Running container (binding /dev/kfd and /dev/dri for ROCm access)."
docker run --rm -it \
  --device=/dev/kfd --device=/dev/dri --group-add video \
  -v "$(pwd)":/workspace -w /workspace \
  $IMAGE_NAME \
  bash -lc "python newGyafcTrainer.py --data_dir data2/GYAFC_Corpus --domains Entertainment_Music Family_Relationships --model_name distilbert-base-uncased --output_dir ./formality_model --epochs 3 --batch_size 16"
