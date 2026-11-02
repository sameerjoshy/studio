#!/usr/bin/env python3
"""Source-footage pipelines for the Studio runner.

Stages:
  transcribe  source -> transcript.json (faster-whisper, local CPU)
  render      source + transcript + plan -> edited mp4

Kinds: talking-head, clip-factory, podcast, dub, screen-demo, hybrid
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def fail(message: str) -> int:
    print(json.dumps({"ok": False, "error": message}))
    return 1


def run(cmd: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def probe(path: Path) -> dict:
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height",
            "-of",
            "json",
            str(path),
        ],
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr[-300:]}")
    data = json.loads(result.stdout or "{}")
    duration = float((data.get("format") or {}).get("duration") or 0)
    has_audio = any(s.get("codec_type") == "audio" for s in data.get("streams") or [])
    has_video = any(s.get("codec_type") == "video" for s in data.get("streams") or [])
    return {"duration": duration, "has_audio": has_audio, "has_video": has_video}


def font_file() -> str | None:
    candidates = [
        os.environ.get("FONT_FILE"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def make_card(path: Path, title: str, subtitle: str = "", width: int = 1920, height: int = 1080) -> None:
    from PIL import Image, ImageDraw, ImageFont

    font_path = font_file()
    title_font = ImageFont.truetype(font_path, 70) if font_path else ImageFont.load_default()
    sub_font = ImageFont.truetype(font_path, 30) if font_path else ImageFont.load_default()

    image = Image.new("RGB", (width, height), "#0A192F")
    draw = ImageDraw.Draw(image)
    draw.rectangle([96, 380, 116, 700], fill="#34D399")

    words = title.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) > 34 and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)

    y = 420
    for line in lines[:3]:
        draw.text((150, y), line, font=title_font, fill="#FFFFFF")
        y += 88

    if subtitle:
        draw.text((150, y + 20), subtitle, font=sub_font, fill="#94A3B8")

    image.save(path)


def srt_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def write_srt(segments: list[dict], path: Path, offset: float = 0.0) -> None:
    lines = []
    for index, segment in enumerate(segments, start=1):
        start = max(0.0, float(segment.get("start") or 0) - offset)
        end = max(start + 0.3, float(segment.get("end") or 0) - offset)
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        lines.append(str(index))
        lines.append(f"{srt_time(start)} --> {srt_time(end)}")
        lines.append(text)
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def stage_transcribe(args) -> int:
    source = Path(args.source)
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    transcript_path = work / "transcript.json"

    if transcript_path.exists():
        print(json.dumps({"ok": True, "transcript": str(transcript_path), "cached": True}))
        return 0

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return fail("faster-whisper is not installed")

    model_size = os.environ.get("WHISPER_MODEL", "base")
    print(f"[source-edit] transcribing with {model_size}", file=sys.stderr)

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments_iter, info = model.transcribe(str(source), vad_filter=True, word_timestamps=False)

    segments = []
    for segment in segments_iter:
        text = (segment.text or "").strip()
        if not text:
            continue
        segments.append({"start": round(segment.start, 3), "end": round(segment.end, 3), "text": text})

    payload = {
        "language": getattr(info, "language", None),
        "duration": round(float(getattr(info, "duration", 0) or 0), 3),
        "segments": segments,
    }
    transcript_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "transcript": str(transcript_path), "segments": len(segments)}))
    return 0


def cut(source: Path, start: float, end: float, out: Path) -> None:
    duration = max(0.4, end - start)
    result = run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-ss", f"{start:.3f}",
            "-t", f"{duration:.3f}",
            "-i", str(source),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k",
            "-movflags", "+faststart",
            str(out),
        ]
    )
    if result.returncode != 0:
        raise RuntimeError(f"cut failed: {result.stderr[-300:]}")


def concat(files: list[Path], out: Path) -> None:
    if len(files) == 1:
        files[0].replace(out)
        return
    listing = out.parent / "concat.txt"
    listing.write_text("\n".join(f"file '{file.as_posix()}'" for file in files), encoding="utf-8")
    result = run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "concat", "-safe", "0",
            "-i", str(listing),
            "-c", "copy",
            "-movflags", "+faststart",
            str(out),
        ]
    )
    if result.returncode != 0:
        result = run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-f", "concat", "-safe", "0",
                "-i", str(listing),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-c:a", "aac",
                str(out),
            ]
        )
    if result.returncode != 0:
        raise RuntimeError(f"concat failed: {result.stderr[-300:]}")


def burn_captions(video: Path, srt: Path, out: Path) -> None:
    style = "FontName=Arial,FontSize=22,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,MarginV=40"
    vf = f"subtitles='{srt.as_posix()}':force_style='{style}'"
    result = run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(video),
            "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(out),
        ]
    )
    if result.returncode != 0:
        # Captions are valuable but must not sink the job.
        print(f"[source-edit] caption burn skipped: {result.stderr[-200:]}", file=sys.stderr)
        video.replace(out)


def keep_ranges(segments: list[dict], duration: float, pad: float = 0.12, merge_gap: float = 0.45) -> list[tuple[float, float]]:
    ranges = []
    for segment in segments:
        start = max(0.0, float(segment.get("start") or 0) - pad)
        end = min(duration, float(segment.get("end") or 0) + pad)
        if end - start < 0.3:
            continue
        ranges.append((start, end))

    merged: list[list[float]] = []
    for start, end in ranges:
        if merged and start - merged[-1][1] <= merge_gap:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    return [(start, end) for start, end in merged]


def render_talking_head(source, transcript, work, plan) -> Path:
    duration = probe(source)["duration"]
    ranges = keep_ranges(transcript.get("segments") or [], duration)

    # If VAD found almost nothing, keep the original instead of a 3-second clip.
    kept = sum(end - start for start, end in ranges)
    if not ranges or kept < max(3.0, duration * 0.15):
        ranges = [(0.0, min(duration, float(plan.get("seconds") or 90)))]

    ranges = ranges[:80]
    segments = []
    for index, (start, end) in enumerate(ranges):
        path = work / f"th-{index:03d}.mp4"
        cut(source, start, end, path)
        segments.append((path, start, end))

    joined = work / "th-joined.mp4"
    concat([path for path, _, _ in segments], joined)

    # Re-time captions onto the joined timeline.
    retimed = []
    cursor = 0.0
    for _, start, end in segments:
        for segment in transcript.get("segments") or []:
            seg_start = float(segment.get("start") or 0)
            seg_end = float(segment.get("end") or 0)
            overlap_start = max(start, seg_start)
            overlap_end = min(end, seg_end)
            if overlap_end - overlap_start < 0.2:
                continue
            retimed.append(
                {
                    "start": cursor + (overlap_start - start),
                    "end": cursor + (overlap_end - start),
                    "text": segment.get("text"),
                }
            )
        cursor += end - start

    srt = work / "talking-head.srt"
    write_srt(retimed, srt)
    out = work / "output.mp4"
    burn_captions(joined, srt, out)
    return out


def render_clip_factory(source, transcript, work, plan) -> Path:
    moments = plan.get("moments") or []
    if not moments:
        raise RuntimeError("No moments were selected")

    clips = []
    for index, moment in enumerate(moments[:6]):
        start = max(0.0, float(moment.get("start") or 0))
        end = max(start + 2.0, float(moment.get("end") or start + 8.0))
        raw = work / f"cf-{index:03d}.mp4"
        cut(source, start, end, raw)

        segment_words = [
            segment
            for segment in transcript.get("segments") or []
            if float(segment.get("end") or 0) > start and float(segment.get("start") or 0) < end
        ]
        srt = work / f"cf-{index:03d}.srt"
        write_srt(segment_words, srt, offset=start)
        burned = work / f"cf-{index:03d}-cap.mp4"
        burn_captions(raw, srt, burned)
        clips.append(burned)

    out = work / "output.mp4"
    concat(clips, out)
    return out


def render_podcast(source, transcript, work, plan) -> Path:
    info = probe(source)
    duration = info["duration"]
    seconds = min(float(plan.get("seconds") or 30), max(5.0, duration))
    title = str(plan.get("title") or "Podcast clip").replace(":", " -").replace("'", "")

    card = work / "podcast-card.png"
    make_card(card, title, "Podcast clip")

    background = work / "podcast-bg.mp4"
    result = run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-loop", "1", "-i", str(card),
            "-t", f"{seconds:.2f}", "-r", "30",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p",
            str(background),
        ]
    )
    if result.returncode != 0:
        raise RuntimeError(f"background failed: {result.stderr[-300:]}")

    out = work / "output.mp4"
    result = run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(background),
            "-i", str(source),
            "-filter_complex",
            (
                "[1:a]showwaves=s=1700x360:mode=cline:colors=#34D399[w];"
                "[0:v][w]overlay=110:560:format=auto[v]"
            ),
            "-map", "[v]",
            "-map", "1:a",
            "-t", f"{seconds:.2f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k",
            "-movflags", "+faststart",
            str(out),
        ]
    )
    if result.returncode != 0:
        raise RuntimeError(f"podcast render failed: {result.stderr[-300:]}")
    return out


def synthesize_dub(text: str, work: Path, plan: dict) -> Path:
    out = work / "dub.wav"
    engine = str(plan.get("engine") or "kokoro")

    if engine == "xtts":
        reference = Path(plan.get("reference") or "")
        if not reference.exists():
            raise RuntimeError("XTTS needs a reference clip from the source")
        from TTS.api import TTS  # type: ignore

        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")
        tts.tts_to_file(
            text=text,
            speaker_wav=str(reference),
            language=str(plan.get("language") or "en"),
            file_path=str(out),
        )
        return out

    from kokoro_onnx import Kokoro  # type: ignore
    import soundfile as sf  # type: ignore

    model = os.environ.get("KOKORO_MODEL", "models/kokoro-v1.0.onnx")
    voices = os.environ.get("KOKORO_VOICES", "models/voices-v1.0.bin")
    kokoro = Kokoro(model, voices)
    samples, sample_rate = kokoro.create(
        text,
        voice=str(plan.get("voice") or "af_heart"),
        speed=1.0,
        lang="en-us",
    )
    sf.write(str(out), samples, sample_rate)
    return out


def render_dub(source, transcript, work, plan) -> Path:
    info = probe(source)
    text = str(plan.get("text") or "").strip()
    if not text:
        raise RuntimeError("No translated text supplied")

    if plan.get("engine") == "xtts" and not plan.get("reference"):
        reference = work / "reference.wav"
        extracted = run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-ss", "2", "-t", "10",
                "-i", str(source),
                "-vn", "-ac", "1", "-ar", "22050",
                str(reference),
            ]
        )
        if extracted.returncode == 0 and reference.exists():
            plan["reference"] = str(reference)

    audio = synthesize_dub(text, work, plan)
    out = work / "output.mp4"

    if info["has_video"]:
        result = run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-i", str(source),
                "-i", str(audio),
                "-map", "0:v", "-map", "1:a",
                "-c:v", "copy",
                "-c:a", "aac", "-b:a", "160k",
                "-shortest",
                "-movflags", "+faststart",
                str(out),
            ]
        )
    else:
        result = run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-f", "lavfi", "-i", "color=c=#0A192F:s=1280x720:r=30",
                "-i", str(audio),
                "-shortest",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-c:a", "aac",
                str(out),
            ]
        )

    if result.returncode != 0:
        raise RuntimeError(f"dub mux failed: {result.stderr[-300:]}")
    return out


def render_screen_demo(source, transcript, work, plan) -> Path:
    info = probe(source)
    seconds = min(float(plan.get("seconds") or info["duration"]), info["duration"])
    trimmed = work / "screen-trim.mp4"
    cut(source, 0.0, seconds, trimmed)

    segments = [
        segment
        for segment in transcript.get("segments") or []
        if float(segment.get("start") or 0) < seconds
    ]
    srt = work / "screen.srt"
    write_srt(segments, srt)
    out = work / "output.mp4"
    burn_captions(trimmed, srt, out)
    return out


def render_hybrid(source, transcript, work, plan) -> Path:
    title = str(plan.get("title") or "Source clip")
    card_png = work / "title-card.png"
    make_card(card_png, title, "GTM-360 - Studio")

    card = work / "title-card.mp4"
    result = run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-loop", "1", "-i", str(card_png),
            "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
            "-t", "3", "-r", "30",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-shortest",
            "-pix_fmt", "yuv420p",
            str(card),
        ]
    )
    if result.returncode != 0:
        raise RuntimeError(f"title card failed: {result.stderr[-300:]}")

    moments = plan.get("moments") or []
    if not moments:
        raise RuntimeError("No moments were selected")

    clips = [card]
    for index, moment in enumerate(moments[:5]):
        start = max(0.0, float(moment.get("start") or 0))
        end = max(start + 2.0, float(moment.get("end") or start + 8.0))
        raw = work / f"hy-{index:03d}.mp4"
        cut(source, start, end, raw)
        segment_words = [
            segment
            for segment in transcript.get("segments") or []
            if float(segment.get("end") or 0) > start and float(segment.get("start") or 0) < end
        ]
        srt = work / f"hy-{index:03d}.srt"
        write_srt(segment_words, srt, offset=start)
        burned = work / f"hy-{index:03d}-cap.mp4"
        burn_captions(raw, srt, burned)
        clips.append(burned)

    out = work / "output.mp4"
    concat(clips, out)
    return out


ASPECT_SIZES = {
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
}

COVER_KINDS = {"talking-head", "clip-factory", "hybrid", "dub"}


def fit_aspect(path: Path, aspect: str, work: Path, kind: str) -> Path:
    if aspect not in ASPECT_SIZES or aspect == "16:9":
        return path

    width, height = ASPECT_SIZES[aspect]
    out = work / f"aspect-{aspect.replace(':', 'x')}.mp4"

    if kind in COVER_KINDS:
        vf = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    else:
        vf = (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x0A192F"
        )

    result = run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(path),
            "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k",
            "-movflags", "+faststart",
            str(out),
        ]
    )
    if result.returncode != 0:
        raise RuntimeError(f"aspect normalise failed: {result.stderr[-300:]}")
    return out


RENDERERS = {
    "talking-head": render_talking_head,
    "clip-factory": render_clip_factory,
    "podcast": render_podcast,
    "dub": render_dub,
    "screen-demo": render_screen_demo,
    "hybrid": render_hybrid,
}


def stage_render(args) -> int:
    source = Path(args.source)
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)

    transcript = json.loads((work / "transcript.json").read_text(encoding="utf-8-sig"))
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8-sig")) if args.plan else {}

    renderer = RENDERERS.get(args.kind)
    if renderer is None:
        return fail(f"Unknown kind: {args.kind}")

    try:
        out = renderer(source, transcript, work, plan)
        out = fit_aspect(out, args.aspect, work, args.kind)
    except Exception as exc:  # pragma: no cover
        import traceback

        print(traceback.format_exc()[-1000:], file=sys.stderr)
        return fail(f"{type(exc).__name__}: {exc}")

    if not out.exists() or out.stat().st_size < 1024:
        return fail("Render produced no usable file")

    final = Path(args.out)
    final.parent.mkdir(parents=True, exist_ok=True)
    if out != final:
        out.replace(final)

    info = probe(final)
    print(
        json.dumps(
            {
                "ok": True,
                "output": str(final),
                "kind": args.kind,
                "duration": info["duration"],
                "has_audio": info["has_audio"],
            }
        )
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=["transcribe", "render"], required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--work", required=True)
    parser.add_argument("--kind")
    parser.add_argument("--plan")
    parser.add_argument("--out")
    parser.add_argument("--aspect", default="16:9")
    args = parser.parse_args()

    if args.stage == "transcribe":
        return stage_transcribe(args)
    if not args.kind or not args.out:
        return fail("render needs --kind and --out")
    return stage_render(args)


if __name__ == "__main__":
    raise SystemExit(main())
