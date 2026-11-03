# GTM Hero — extra pose prompts

Same rules as the first pack: same Gemini chat, attach the **stance** image as
the reference each time, one pose per message, flat magenta `#FF00FF`, full
body, no shadow, no text, no watermark.

Save into `D:\GTM-Engine\Poses\` with these exact names:

| Pose | File |
|---|---|
| Skeptical | `skeptical.png` |
| Facepalm | `facepalm.png` |
| Ship it | `shipit.png` |
| Mic drop | `micdrop.png` |

## Master prompt

```text
Use the attached image ONLY as the exact, locked character reference.
Redesign nothing. Keep the same face, hair, domino mask, body proportions,
costume, colours, cape, and the circular glowing GTM chest badge.

Render ONE full-body pose, head to toe, centred in frame.
Pose: <PASTE POSE HERE>

Background: flat solid magenta #FF00FF, edge to edge. No shadow, no floor,
no horizon, no props, no text, no watermark, no border, no extra characters.
Lighting: even studio light, soft, no dramatic shadows.
Camera: orthographic, eye level, no perspective distortion.
Output: one character only, sharp, high-resolution PNG.
```

## Pose lines

- **Skeptical** — `Skeptical expression: one eyebrow raised, arms crossed, head tilted slightly, unconvinced look.`
- **Facepalm** — `Facepalm: right hand covering the forehead, head tilted down, exasperated but friendly.`
- **Ship it** — `Ship it: both hands pushing forward at chest height as if launching something, determined grin.`
- **Mic drop** — `Mic drop: right arm extended down and out after releasing a microphone, confident look, left hand on hip.`

After the files are in place, run:

```bash
python scripts/key_poses.py --src "D:/GTM-Engine/Poses" --out runner/templates/hero-kit/poses
```

The keyer skips optional poses that are not present, so the existing pack keeps
working.
