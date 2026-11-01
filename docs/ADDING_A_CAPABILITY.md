# Adding a capability

The catalog is the contract. One entry plus one runner module is the whole
change; the page, the router, and the slash-commands all read from the same
place.

## 1. Add the entry

Edit `apps/api/src/capabilities.ts` and append to `CAPABILITIES`:

```ts
{
  id: 'audio-jingle',
  studio: 'Voices',
  name: 'Jingle',
  outcome: 'A short musical sting from a mood description.',
  bestFor: ['Podcast intros', 'Product stings'],
  inputs: ['Mood', 'Duration'],
  examples: ['A warm 5-second sting for a podcast intro'],
  estTime: '1-2 minutes',
  cost: 'Free',
  licence: 'MIT',
  status: 'beta',
  stages: ['Pick a palette', 'Synthesise', 'Normalise'],
  limits: ['5-10 seconds only'],
}
```

`status` is one of `live`, `beta`, `planned`. Planned entries render as disabled
cards with `disabledReason`, which is how the list grows in public without
promising something that does not run.

## 2. Extend the spec contract

Add a branch to `validateSpec` in `apps/api/src/lib/spec.ts`. It receives the
raw model output and must return `{ ok, spec }` or `{ ok: false, problem }`.
Sanitise aggressively: the model is not trusted.

Then add the matching `spec` shape to the router manifest in
`apps/api/src/router.ts` so the model knows what to produce.

## 3. Add the runner

Create `runner/jobs/audio-jingle.mjs`:

```js
export default async function audioJingle({ spec, workDir, progress, root }) {
  await progress('synthesising', 40, 'Generating the sting');
  const out = path.join(workDir, 'jingle.wav');
  // ... run your tool ...
  return {
    file: out,
    filename: 'jingle.wav',
    contentType: 'audio/wav',
    meta: { duration: 5 },
  };
}
```

Register it in the `JOBS` map in `runner/entry.mjs`.

## 4. Install any system dependency

Add the install step to `.github/workflows/render.yml`. Keep it conditional on
the job capability if it is heavy, so unrelated jobs do not pay the startup cost.

## 5. Verify

```bash
npm --prefix apps/api run typecheck
npm run build:web
```

Then dispatch a job through the chat and watch `st_events` in the job card.
