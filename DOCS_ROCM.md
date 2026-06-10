Running training on an AMD GPU (ROCm) using Docker
--------------------------------------------------

This repository includes a `Dockerfile.rocm` and a helper script
`scripts/run_rocm_docker.sh` to run training inside a container that
provides a PyTorch build compatible with AMD GPUs (ROCm).

Quick steps

1. Choose a ROCm PyTorch base image that matches your host ROCm version.
   Examples (may need adjustment for your system):

   - `rocm/pytorch:5.6_ubuntu22.04_py3.11`
   - `rocm/pytorch:5.4_ubuntu20.04_py3.8`

   If you're unsure, consult AMD/ROCm documentation for the right image for
   your GPU/kernel.

2. Build and run with the helper script. Example using a specific base image:

```bash
./scripts/run_rocm_docker.sh rocm/pytorch:5.6_ubuntu22.04_py3.11
```

If you omit the argument, the Dockerfile's default `BASE_IMAGE` will be used.

Notes and tips

- The Dockerfile expects the base image to provide a working `torch` build for
  ROCm. We install the remaining Python dependencies from
  `requirements-rocm.txt` (which deliberately omits `torch`).
- The container run command binds `/dev/kfd` and `/dev/dri` and adds the `video`
  group. Depending on your system you may also need to bind additional devices
  (e.g. RDMA devices) or adjust permissions.
- If you prefer not to use Docker, you must install a ROCm-compatible PyTorch
  release on the host. That typically requires specific kernel and ROCm stack
  versions — consult ROCm installation docs.

If you want, I can:
- detect your host ROCm version and suggest a matching Docker base image, or
- add an `nvidia-docker`/`--gpus`-style wrapper (not applicable to AMD) or more
  advanced device mappings for multi-GPU runs.
