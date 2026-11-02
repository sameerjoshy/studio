#!/usr/bin/env python3
"""OpenMontage documentary driver for the Studio runner.

Two modes, so the caller can rerank candidates before composing:

  --mode search   direct_clip_search -> candidates.json
  --mode compose  picks.json        -> final mp4

Uses OpenMontage's own tools on the fast path (no CLIP model).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# Wikimedia carries a growing number of AI-generated uploads, often watermarked.
# The documentary path promises real footage, so reject them by filename.
AI_MARKERS = re.compile(
    r"(hailuo|minimax|sora|veo|kling|runway|pika|luma|generated|text-to-video|ai-?generated|cyberpunk|animation|animated)",
    re.IGNORECASE,
)

SOURCE_RANK = {
    "pexels": 6,
    "pixabay": 5,
    "coverr": 4,
    "wikimedia": 3,
    "nasa": 2,
    "nara": 1,
    "archive_org": 1,
    "pond5_pd": 0,
    "loc": 0,
}

STOPWORDS = {
    "the", "and", "with", "for", "from", "into", "over", "under", "that", "this",
    "video", "footage", "stock", "clip", "real",
}


def fail(message: str) -> int:
    print(json.dumps({"ok": False, "error": message}))
    return 1


def tokens(value: str) -> set[str]:
    cleaned = "".join(ch if ch.isalnum() else " " for ch in value.lower())
    return {word for word in cleaned.split() if len(word) > 3 and word not in STOPWORDS}


def relevance(query: str, clip: dict) -> int:
    query_tokens = tokens(query)
    if not query_tokens:
        return 0
    # Only the clip's own filename. Including the slot query or provider tags
    # would make unrelated uploads look relevant.
    haystack = str(clip.get("source_url") or "")
    return len(query_tokens & tokens(haystack))


def load_tools(repo: Path):
    sys.path.insert(0, str(repo))
    os.chdir(repo)
    from tools.video.direct_clip_search import DirectClipSearch
    from tools.video.video_compose import VideoCompose

    return DirectClipSearch, VideoCompose


def mode_search(args, repo: Path) -> int:
    DirectClipSearch, _ = load_tools(repo)

    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    slots = plan.get("slots") or []
    if not slots:
        return fail("Plan has no slots")

    output_dir = repo / "projects" / args.project / "assets"
    output_dir.mkdir(parents=True, exist_ok=True)

    queries = [
        {
            "query": str(slot.get("query") or "").strip(),
            "slot_id": str(slot.get("slot_id") or f"slot_{index:02d}"),
            "kind": "video",
        }
        for index, slot in enumerate(slots)
        if str(slot.get("query") or "").strip()
    ]
    if not queries:
        return fail("Plan has no usable queries")

    preferred_sources = [
        name.strip()
        for name in os.environ.get(
            "OPENMONTAGE_SOURCES", "pexels,pixabay,coverr,wikimedia,nasa"
        ).split(",")
        if name.strip()
    ]

    # Only ask for sources that are actually configured, otherwise the tool
    # rejects the whole batch. Adding a free Pexels key upgrades this silently.
    try:
        from tools.video.stock_sources import available_sources

        available = {source.name for source in available_sources()}
    except Exception:
        available = set()

    configured_sources = [name for name in preferred_sources if name in available] or None

    print(f"[openmontage] searching {len(queries)} slots", file=sys.stderr)

    tool = DirectClipSearch()
    result = tool.execute(
        {
            "output_dir": str(output_dir),
            "queries": queries,
            "sources": configured_sources,
            "clips_per_query": 3,
            "extract_thumbnails": False,
            "skip_existing": True,
            "timeout_seconds": 600,
            "filters": {
                "orientation": "landscape",
                "min_width": 960,
                "max_duration": 45,
            },
        }
    )

    if not result.success:
        return fail(f"Clip search failed: {result.error}")

    clips = result.data.get("clips", [])
    if not clips:
        return fail("Clip search returned no clips")

    by_slot: dict[str, list[dict]] = {}
    for clip in clips:
        if clip.get("kind") != "video":
            continue
        if AI_MARKERS.search(str(clip.get("source_url") or "")):
            continue
        path = Path(str(clip.get("path") or ""))
        if not path.exists() or float(clip.get("duration") or 0) < 1.5:
            continue
        by_slot.setdefault(str(clip.get("slot_id")), []).append(clip)

    out_slots = []
    for index, slot in enumerate(slots):
        slot_id = str(slot.get("slot_id") or f"slot_{index:02d}")
        query = str(slot.get("query") or "")
        candidates = by_slot.get(slot_id, [])

        def score(clip: dict) -> tuple[float, float, float]:
            return (
                relevance(query, clip),
                SOURCE_RANK.get(str(clip.get("source")), 0),
                float(clip.get("duration") or 0),
            )

        candidates = sorted(candidates, key=score, reverse=True)[:5]

        out_slots.append(
            {
                "slot": slot_id,
                "query": query,
                "seconds": float(slot.get("seconds") or 5),
                "intent": str(slot.get("intent") or ""),
                "candidates": [
                    {
                        "path": str(clip.get("path")),
                        "source": clip.get("source"),
                        "source_url": clip.get("source_url"),
                        "duration": float(clip.get("duration") or 0),
                        "license": clip.get("license"),
                        "relevance": relevance(query, clip),
                    }
                    for clip in candidates
                ],
            }
        )

    payload = {
        "ok": True,
        "title": plan.get("title"),
        "tone": plan.get("tone"),
        "sources": result.data.get("resolved_sources", []),
        "slots": out_slots,
    }
    Path(args.out_json).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "candidates": str(args.out_json), "slots": len(out_slots)}))
    return 0


def mode_compose(args, repo: Path) -> int:
    _, VideoCompose = load_tools(repo)

    payload = json.loads(Path(args.picks).read_text(encoding="utf-8"))
    picks = payload.get("picks") or []
    if not picks:
        return fail("No picks supplied")

    cuts = []
    assets = []

    for pick in picks:
        path = Path(str(pick.get("path") or ""))
        if not path.exists():
            continue
        hold = max(1.5, min(float(pick.get("hold") or 4), float(pick.get("duration") or 4)))
        cuts.append(
            {
                "source": str(path),
                "in_seconds": 0.0,
                "out_seconds": round(hold, 2),
                "reason": str(pick.get("reason") or pick.get("query") or ""),
                "transition": "cut",
            }
        )
        assets.append(
            {
                "slot": pick.get("slot"),
                "query": pick.get("query"),
                "source": pick.get("source"),
                "source_url": pick.get("source_url"),
                "license": pick.get("license"),
                "duration": float(pick.get("duration") or 0),
                "hold": round(hold, 2),
            }
        )

    if not cuts:
        return fail("No usable picks")

    total = round(sum(cut["out_seconds"] for cut in cuts), 2)
    edit_decisions = {
        "render_runtime": "ffmpeg",
        "cuts": cuts,
        "metadata": {
            "compose_target": {"width": 1920, "height": 1080, "fit": "cover"},
            "music_plan": {"source": "none", "note": "Studio documentary fast path"},
            "total_duration_seconds": total,
        },
    }

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[openmontage] composing {len(cuts)} cuts ({total}s)", file=sys.stderr)
    compose = VideoCompose()
    result = compose.execute(
        {
            "operation": "compose",
            "edit_decisions": edit_decisions,
            "output_path": str(out_path),
            "crf": 20,
            "preset": "medium",
        }
    )
    if not result.success:
        return fail(f"Compose failed: {result.error}")
    if not out_path.exists() or out_path.stat().st_size < 1024:
        return fail("Compose reported success but produced no usable file")

    print(
        json.dumps(
            {
                "ok": True,
                "output": str(out_path),
                "cuts": len(cuts),
                "seconds": total,
                "assets": assets,
            }
        )
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["search", "compose"], required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--project", default="studio-documentary")
    parser.add_argument("--plan")
    parser.add_argument("--out-json")
    parser.add_argument("--picks")
    parser.add_argument("--out")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    if not (repo / "tools").is_dir():
        return fail(f"OpenMontage checkout not found at {repo}")

    try:
        if args.mode == "search":
            if not args.plan or not args.out_json:
                return fail("search needs --plan and --out-json")
            return mode_search(args, repo)
        if not args.picks or not args.out:
            return fail("compose needs --picks and --out")
        return mode_compose(args, repo)
    except Exception as exc:  # pragma: no cover
        import traceback

        print(traceback.format_exc()[-1000:], file=sys.stderr)
        return fail(f"{type(exc).__name__}: {exc}")


if __name__ == "__main__":
    raise SystemExit(main())
