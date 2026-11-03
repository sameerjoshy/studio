#!/usr/bin/env python3
"""XTTS v2 voice cloning. Non-commercial use only (Coqui Public Model License)."""

import argparse
import os
import sys
import tempfile
import urllib.request

os.environ.setdefault("COQUI_TOS_AGREED", "1")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--language", default="en")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    try:
        from TTS.api import TTS
    except ImportError:
        sys.stderr.write("Coqui TTS is not installed. Run: pip install TTS\n")
        return 2

    reference = args.reference
    temp_path = None

    if reference.startswith("http"):
        handle, temp_path = tempfile.mkstemp(suffix=".wav")
        os.close(handle)
        urllib.request.urlretrieve(reference, temp_path)
        reference = temp_path

    if not os.path.exists(reference):
        sys.stderr.write(f"Reference audio not found: {reference}\n")
        return 3

    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    tts.tts_to_file(
        text=args.text,
        speaker_wav=reference,
        language=args.language,
        file_path=args.out,
    )

    if temp_path and os.path.exists(temp_path):
        os.remove(temp_path)

    print(f"wrote {args.out} (xtts-v2, language={args.language})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
