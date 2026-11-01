# Architecture

## Design constraints

1. **No local hardware.** All rendering happens on remote free compute.
2. **Free by default.** Public GitHub repo -> unlimited Actions minutes; Cloudflare
   Workers + Supabase free tiers; Gemini free tier for the model.
3. **One origin.** The Worker serves the built UI and the API, so the session
   cookie is first-party and CORS never appears.
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

## Auth

A passphrase is exchanged for an HMAC-signed, HttpOnly cookie (30 days).
`STUDIO_SESSION_SECRET` signs it. All `/api/*` routes except `POST /api/auth`
require the cookie. Failed attempts are rate-limited per IP in isolate memory.

This is a single-operator gate, not a multi-tenant identity system. If Studio
ever grows users, replace it with the Supabase JWT pattern used by
`content-engine`.

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
