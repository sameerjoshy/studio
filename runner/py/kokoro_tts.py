#!/usr/bin/env python3
"""Kokoro ONNX narration. Called by the Studio runner."""

import argparse
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", default="af_heart")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    try:
        from kokoro_onnx import Kokoro
    except ImportError:
        sys.stderr.write("kokoro-onnx is not installed. Run: pip install kokoro-onnx soundfile\n")
        return 2

    try:
        import soundfile as sf
    except ImportError:
        sys.stderr.write("soundfile is not installed. Run: pip install kokoro-onnx soundfile\n")
        return 2

    for label, path in (("model", args.model), ("voices", args.voices)):
        if not os.path.exists(path):
            sys.stderr.write(f"Kokoro {label} not found at {path}\n")
            return 3

    kokoro = Kokoro(args.model, args.voices)

    samples, sample_rate = kokoro.create(
        args.text,
        voice=args.voice,
        speed=args.speed,
        lang="en-us",
    )

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    sf.write(args.out, samples, sample_rate)

    seconds = len(samples) / float(sample_rate)
    print(f"wrote {args.out} ({seconds:.1f}s at {sample_rate}Hz, voice={args.voice})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
