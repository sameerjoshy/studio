#!/usr/bin/env python3
"""Deterministic OpenMontage documentary driver for the Studio runner.

Uses OpenMontage's own tools, on the fast path that needs no CLIP model:
  direct_clip_search -> pick one clip per slot -> video_compose (ffmpeg)

Input: a JSON plan {"title", "tone", "slots": [{"query", "seconds", "intent"}]}
Output: an mp4 at --out, plus a JSON result on the last stdout line.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


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
    "city", "life", "people", "video", "footage", "stock", "clip", "real",
}


def fail(message: str, code: int = 1) -> int:
    print(json.dumps({"ok": False, "error": message}))
    return code


def tokens(value: str) -> set[str]:
    cleaned = "".join(ch if ch.isalnum() else " " for ch in value.lower())
    return {word for word in cleaned.split() if len(word) > 3 and word not in STOPWORDS}


def relevance(query: str, clip: dict) -> int:
    query_tokens = tokens(query)
    if not query_tokens:
        return 0
    haystack = " ".join(
        str(part or "")
        for part in (clip.get("source_url"), clip.get("source_tags"), clip.get("query"))
    )
    return len(query_tokens & tokens(haystack))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--project", default="studio-documentary")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    if not (repo / "tools").is_dir():
        return fail(f"OpenMontage checkout not found at {repo}")

    sys.path.insert(0, str(repo))
    os.chdir(repo)

    try:
        from tools.video.direct_clip_search import DirectClipSearch
        from tools.video.video_compose import VideoCompose
    except Exception as exc:  # pragma: no cover - import failure is fatal
        return fail(f"Could not import OpenMontage tools: {exc}")

    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    slots = plan.get("slots") or []
    if not slots:
        return fail("Plan has no slots")

    output_dir = repo / "projects" / args.project / "assets"
    output_dir.mkdir(parents=True, exist_ok=True)

    queries = [
        {
            "query": str(slot.get("query") or "").strip(),
            "slot_id": f"slot_{index:02d}",
            "kind": "video",
        }
        for index, slot in enumerate(slots)
        if str(slot.get("query") or "").strip()
    ]
    if not queries:
        return fail("Plan has no usable queries")

    print(f"[openmontage] searching {len(queries)} slots", file=sys.stderr)

    configured_sources = [
        name.strip()
        for name in os.environ.get("OPENMONTAGE_SOURCES", "wikimedia,nasa,archive_org").split(",")
        if name.strip()
    ]

    search = DirectClipSearch()
    search_result = search.execute(
        {
            "output_dir": str(output_dir),
            "queries": queries,
            "sources": configured_sources,
            "clips_per_query": 3,
            "extract_thumbnails": False,
            "skip_existing": True,
            "timeout_seconds": 420,
            "filters": {
                "orientation": "landscape",
                "min_width": 960,
                "max_duration": 60,
            },
        }
    )

    if not search_result.success:
        return fail(f"Clip search failed: {search_result.error}")

    clips = search_result.data.get("clips", [])
    if not clips:
        return fail("Clip search returned no clips")

    by_slot: dict[str, list[dict]] = {}
    for clip in clips:
        if clip.get("kind") != "video":
            continue
        by_slot.setdefault(str(clip.get("slot_id")), []).append(clip)

    cuts = []
    assets = []

    for index, slot in enumerate(slots):
        slot_id = f"slot_{index:02d}"
        candidates = by_slot.get(slot_id) or []
        candidates = [c for c in candidates if Path(str(c.get("path"))).exists()]
        if not candidates:
            continue

        # Rank by query relevance, then source quality, then duration fit.
        wanted = float(slot.get("seconds") or 5)
        query = str(slot.get("query") or "")
        usable = [c for c in candidates if float(c.get("duration") or 0) >= 1.5]
        if not usable:
            continue

        def score(clip: dict) -> tuple[float, float, float, float]:
            hit = relevance(query, clip)
            duration = float(clip.get("duration") or 0)
            source_rank = SOURCE_RANK.get(str(clip.get("source")), 0)
            enough = 1.0 if duration >= wanted else 0.0
            return (hit, source_rank, enough, min(duration, wanted))

        picked = max(usable, key=score)

        # A clip that matches none of the query words is almost always noise from
        # an open archive. Drop the slot instead of shipping an unrelated shot.
        if relevance(query, picked) == 0 and len(slots) > 1:
            print(f"[openmontage] dropping {slot_id}: no relevant clip", file=sys.stderr)
            continue

        duration = float(picked.get("duration") or 0)
        hold = round(min(wanted, duration), 2)

        cuts.append(
            {
                "source": str(picked.get("path")),
                "in_seconds": 0.0,
                "out_seconds": hold,
                "reason": str(slot.get("intent") or slot.get("query") or ""),
                "transition": "cut",
            }
        )
        assets.append(
            {
                "slot": slot_id,
                "query": slot.get("query"),
                "source": picked.get("source"),
                "source_url": picked.get("source_url"),
                "license": picked.get("license"),
                "duration": duration,
                "hold": hold,
            }
        )

    if not cuts:
        return fail("No usable clips survived review")

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
    compose_result = compose.execute(
        {
            "operation": "compose",
            "edit_decisions": edit_decisions,
            "output_path": str(out_path),
            "crf": 20,
            "preset": "medium",
        }
    )

    if not compose_result.success:
        return fail(f"Compose failed: {compose_result.error}")

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
                "sources": search_result.data.get("resolved_sources", []),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
