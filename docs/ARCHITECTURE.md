# Architecture

## Design constraints

1. **No local hardware.** All rendering happens on remote free compute.
2. **Free by default.** Public GitHub repo -> unlimited Actions minutes; Cloudflare
   Workers + Supabase free tiers; Gemini free tier for the model.
3. **One origin.** The Worker serves the built UI and the API, so the session
   API and UI share a host and CORS never appears.
4. **Catalog is the contract.** One capability list drives the UI, the router,
   and the job dispatch. Nothing is hard-coded per surface.

## Request flow

```
POST /api/chat
  -> Gemini Flash (free) or DeepSeek (fallback), JSON mode
  -> { action, capability, spec, reply }
  -> validate spec against the capability id
  -> insert st_jobs row
  -> POST /repos/{repo}/actions/workflows/render.yml/dispatches { job_id }
  -> return { reply, job }
```

The UI polls `GET /api/jobs/:id` every 2.5 s while a job is active. The runner
writes `st_events` rows as it moves through stages, so the transcript is a real
log rather than a client-side guess.

## Runner

`runner/entry.mjs` reads `JOB_ID`, loads the job, dispatches to
`runner/jobs/<capability>.mjs`, uploads the artifact to the private `studio`
bucket, and marks the job complete.

Adding a job module: default-export an async function that receives
`{ job, spec, workDir, progress, root }` and returns
`{ file, filename, contentType, meta }`.

## PPT Master harness

`ppt-master` is a skill, not a CLI: it expects an AI to read its workflow, author
SVGs, gate them, and export. `runner/lib/harness.mjs` is a bounded pipeline that
does the same job without a human:

1. Plan the deck (one model call: title, subtitle, content slides)
2. Author one SVG per page (one call per slide, fixed 1280x720 contract)
3. Run `svg_quality_checker.py --quick-generate --canonical-authoring --stage final --json`
4. Repair failing pages from the JSON report (max 2 rounds)
5. Run `svg_to_pptx.py --quick-generate`

That is 6-8 model calls per deck instead of an open-ended tool loop, which was
unstable and expensive. Model calls go through `POST /api/internal/llm`, guarded
by `RUNNER_SECRET`, so provider keys never leave the Worker. If the harness or
the checker fails, the job falls back to the deterministic Deck Studio so the
user still gets a file.

## OpenMontage documentary path

`film-documentary` runs OpenMontage's own tools on its fast path, which needs no
CLIP model:

1. Plan 4-8 literal shot queries with the model
2. `direct_clip_search` against every configured free source: Pexels, Pixabay,
   Coverr, Wikimedia Commons, and NASA
3. Rank candidates by filename relevance, then source quality, then duration
4. A model reranker picks one clip per shot and may reject all of them
5. A second search pass retries dropped shots with a two-word query
6. `video_compose` with `render_runtime: ffmpeg` trims and concatenates the cut

If fewer than three shots survive, the job fails with a clear message instead of
shipping an unrelated cut. A free `PEXELS_API_KEY` (Actions secret) is the single
biggest quality upgrade: it turns open-archive guesswork into real stock footage.

The driver is `runner/py/openmontage_documentary.py`; it prints one JSON result
line. OpenMontage is cloned per job and kept as an external process, so its
AGPL-3.0 terms do not reach Studio's MIT code.

Known limit: open-archive search is literal. Abstract briefs retrieve noise, and
a free Pexels key is the single biggest quality upgrade when added.

## OpenMontage animated explainer

`film-explainer` and `film-motion-graphics` use OpenMontage's Remotion composer.
The model plans 5-8 scenes (hero title, text card, callout, stat, comparison,
bar/pie chart, KPI grid, progress), the job writes `props.json`, and Remotion
renders `Explainer` in headless Chrome. `node_modules` is installed on the first
run and reused by the Actions cache.

Visuals only today: there is no narration, and charts may only use numbers the
brief actually states.

## Pipeline coverage

| OpenMontage pipeline | Studio card | Status | Blocker |
|---|---|---|---|
| documentary-montage | Documentary Cut | beta | none |
| animated-explainer | Animated Explainer | beta | none |
| animation | Motion Graphics | beta | shares the explainer engine |
| cinematic | Cinematic | planned | AI video provider keys |
| avatar-spokesperson | Avatar Spokesperson | planned | avatar provider key |
| talking-head | Talking Head | beta | none |
| clip-factory | Clip Factory | beta | none |
| localization-dub | Localization Dub | beta | none |
| podcast-repurpose | Podcast Repurpose | beta | none |
| screen-demo | Screen Demo | beta | none |
| hybrid | Hybrid | beta | none |
| character-animation | Character Animation | planned | rig authoring pass |

`framework-smoke` is a test fixture, not a product pipeline.

## Source uploads

The six source pipelines share one input path:

1. `POST /api/uploads/presign` validates the file (250 MB cap, video/audio
   types) and returns a Supabase signed upload URL.
2. The browser PUTs the file straight to Supabase. The file never passes through
   the Worker, so the plan's request-size limit does not apply.
3. `st_jobs.spec.source_path` carries the object key.
4. The runner downloads it with the service key, and deletes it in a `finally`
   block whether the job succeeds or fails.
5. A daily cron removes outputs older than 30 days and any orphaned source older
   than 24 hours.

All six jobs run `runner/jobs/source-edit.mjs`: faster-whisper transcribes on the
runner's CPU (no API key), the model picks moments or translates when needed, and
mode-specific ffmpeg work renders the cut. Dubbing supports Kokoro (Apache-2.0)
and XTTS (non-commercial); the workflow installs only the engine the job asks
for, because the two have conflicting NumPy requirements.

## GTM Guardian (Blender)

The Blender path is built and measured, but not shipped. `runner/blender/gtm_guardian.py`
builds a stylised low-poly hero procedurally (own mesh, materials, cape, GTM badge)
and renders a keyframed beat on Cycles CPU. Measured on the free runner: **2 seconds
at 1280x720, 32 samples, ~20 minutes** (no denoiser in the apt Blender build).

The blocker is art, not plumbing: primitives produce a blockout, not the
reference-quality render from the Gemini concept. Options are a proper 3D asset,
a GPU image-to-3D pass, or a 2.5D parallax treatment of the Gemini still.

## Access

Studio is open: there is no login. The UI is public and every generation route
is callable by anyone with the URL.

Two guards remain, neither of which is authentication:

- **Spend guard** - `POST /api/chat` and `POST /api/run` are limited to 60
  requests per 10 minutes per IP, in isolate memory. This is best-effort and
  only stops a single client from draining Actions minutes or model credits.
- **Runner gateway** - `POST /api/internal/llm` requires `RUNNER_SECRET`, so the
  model provider keys never leave the Worker.

If the surface needs to be private again, add Cloudflare Access in front of the
route (free up to 50 users) or reintroduce the passphrase cookie that this
replaced.

## Storage

Private Supabase bucket `studio`, object path `<job_id>/<filename>`. The Worker
issues 7-day signed URLs on read, so files are never public.

## Failure handling

- Dispatch failure marks the job `error` immediately.
- A runner crash marks the job `error` with the tail of stderr.
- `POST /api/jobs/:id/retry` resets state and re-dispatches the same spec.
- The UI surfaces the last four events on the job card.

## Cost

- Gemini free tier first, DeepSeek second.
- No LLM call inside the runner: specs are fully resolved before dispatch.
- Token usage and cost are stored on the job row (`tokens_in`, `tokens_out`,
  `cost_usd`) and shown in the library.
