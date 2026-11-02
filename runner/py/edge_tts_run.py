#!/usr/bin/env python3
"""Microsoft Edge TTS narration. Opt-in only: unofficial endpoint, no key."""

import argparse
import asyncio
import os
import subprocess
import sys
import tempfile


async def synthesize(text: str, voice: str, rate: str, out: str) -> None:
    import edge_tts

    handle, mp3_path = tempfile.mkstemp(suffix=".mp3")
    os.close(handle)

    try:
        communicate = edge_tts.Communicate(text, voice, rate=rate)
        await communicate.save(mp3_path)

        result = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", mp3_path, out],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg convert failed: {result.stderr[-300:]}")
    finally:
        if os.path.exists(mp3_path):
            os.remove(mp3_path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", default="en-US-ChristopherNeural")
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    try:
        asyncio.run(synthesize(args.text, args.voice, args.rate, args.out))
    except Exception as exc:
        print(f"edge-tts failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(f"wrote {args.out} (edge-tts, voice={args.voice})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
