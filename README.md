# Studio

Live at **https://apps.gtm-360.com/studio** (open access, noindex). Also reachable
at **https://studio.sameerjoshy.workers.dev**.

The GTM-360 control room for creative output. One chat box; Studio picks the
right engine, runs it on free remote compute, and hands back a file.

- **Decks** - native, editable `.pptx` from a brief or pasted source
- **Films** - 12-second branded films rendered with HyperFrames
- **Voices** - narration with Kokoro, voice cloning with XTTS

No local hardware, no paid rendering APIs. The only variable cost is the model
used to route and write content, and that runs on a free tier first.

## How it works

```
Browser -> studio Worker (Cloudflare) -> job row (Supabase)
                                      -> workflow_dispatch (GitHub Actions)
GitHub Action -> node runner -> tool -> Supabase Storage
Browser <- poll /api/jobs/:id <- progress events
```

The Worker is control-plane only. Every heavy tool runs in a GitHub Action,
which is free for public repositories.

## Layout

```
apps/web            React + Vite + Tailwind UI (chat, catalog, library)
apps/api            Cloudflare Worker: auth, router, jobs, catalog
runner              Node job runner executed by GitHub Actions
runner/templates    HyperFrames composition for the brand film
supabase            st_jobs / st_events migration
docs                architecture, licences, adding a capability
```

## Local development

```bash
npm install --prefix apps/web
npm install --prefix apps/api
npm install --prefix runner

npm run dev:api     # wrangler dev on :8787
npm run dev:web     # vite on :5175 (proxies /api)
```

Create `apps/api/.dev.vars` from `.dev.vars.example` and fill in the secrets.

## Secrets

Worker (`wrangler secret put <NAME>`):

| Name | Purpose |
|---|---|
| `GITHUB_TOKEN` | fine-grained token with Actions write on this repo |
| `RUNNER_SECRET` | shared secret for the runner-only model gateway |
| `SUPABASE_URL` | shared Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (server only) |
| `GROQ_API_KEY` | free-tier router and content model (primary) |
| `DEEPSEEK_API_KEY` | paid fallback (~$0.001 per request) |
| `GEMINI_API_KEY` | optional third fallback |

Repository secrets (Settings -> Secrets and variables -> Actions):

| Name | Purpose |
|---|---|
| `SUPABASE_URL` | runner writes job state and uploads output |
| `SUPABASE_SERVICE_ROLE_KEY` | same |

## Deploy

```bash
npm run build:web
npm --prefix apps/api run deploy
```

The Worker name is `studio` and serves both the API and the built static app on
one origin, so the API and UI share a host and CORS never appears.

## Add a capability

See `docs/ADDING_A_CAPABILITY.md`. The catalog, the router prompt, and the UI
all read from `apps/api/src/capabilities.ts`; one entry plus one runner module
is the whole change.

## Licence

MIT. Third-party engines keep their own licences - read `docs/LICENCES.md`
before shipping output commercially.
