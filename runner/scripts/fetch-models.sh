#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="${MODELS_DIR:-runner/models}"
BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

mkdir -p "$MODELS_DIR"

if [ ! -f "$MODELS_DIR/kokoro-v1.0.onnx" ]; then
  echo "Downloading Kokoro model..."
  curl -L --retry 3 --fail -o "$MODELS_DIR/kokoro-v1.0.onnx" "$BASE/kokoro-v1.0.onnx"
fi

if [ ! -f "$MODELS_DIR/voices-v1.0.bin" ]; then
  echo "Downloading Kokoro voices..."
  curl -L --retry 3 --fail -o "$MODELS_DIR/voices-v1.0.bin" "$BASE/voices-v1.0.bin"
fi

ls -lh "$MODELS_DIR"
