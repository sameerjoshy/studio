# Studio

Live at **https://studio.sameerjoshy.workers.dev** (passphrase-gated, noindex).

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
| `STUDIO_PASSPHRASE` | the passphrase that unlocks the chat |
| `STUDIO_SESSION_SECRET` | HMAC key for the session cookie |
| `GITHUB_TOKEN` | fine-grained token with Actions write on this repo |
| `SUPABASE_URL` | shared Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (server only) |
| `GEMINI_API_KEY` | free-tier router and content model |
| `DEEPSEEK_API_KEY` | fallback model |

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
one origin, so the session cookie is first-party.

## Add a capability

See `docs/ADDING_A_CAPABILITY.md`. The catalog, the router prompt, and the UI
all read from `apps/api/src/capabilities.ts`; one entry plus one runner module
is the whole change.

## Licence

MIT. Third-party engines keep their own licences - read `docs/LICENCES.md`
before shipping output commercially.
