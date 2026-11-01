import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { AudioLines, ChevronDown, Clapperboard, Presentation, Wand2 } from 'lucide-react';

const STUDIOS = [
  { name: 'Decks', icon: Presentation, blurb: 'Editable output you can keep working in.' },
  { name: 'Films', icon: Clapperboard, blurb: 'Short, branded motion from a brief.' },
  { name: 'Voices', icon: AudioLines, blurb: 'Narration and voice cloning, generated locally.' },
];

const STATUS_TONE = {
  live: 'border-mint/30 bg-mint/10 text-mint',
  beta: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  planned: 'border-slate-600/40 bg-slate-700/20 text-slate-400',
};

function CapabilityCard({ capability, onUse }) {
  const [open, setOpen] = useState(false);
  const planned = capability.status === 'planned';

  return (
    <div
      className={clsx(
        'card overflow-hidden transition',
        planned ? 'opacity-70' : 'hover:border-accent/40',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-4 p-5 text-left"
      >
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={clsx('pill', STATUS_TONE[capability.status])}>{capability.status}</span>
            <span className="text-[11px] text-slate-500">{capability.estTime}</span>
            <span className="text-[11px] text-slate-600">·</span>
            <span className="text-[11px] text-slate-500">{capability.cost}</span>
          </div>
          <h3 className="text-base font-semibold text-white">{capability.name}</h3>
          <p className="mt-1 text-sm leading-relaxed text-fog">{capability.outcome}</p>
          {planned && capability.disabledReason && (
            <p className="mt-2 text-xs text-slate-500">{capability.disabledReason}</p>
          )}
        </div>
        <ChevronDown
          className={clsx('mt-1 h-4 w-4 shrink-0 text-slate-500 transition', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="space-y-5 border-t border-line/60 bg-ink/30 px-5 py-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Best for
              </h4>
              <ul className="space-y-1.5">
                {capability.bestFor.map((item) => (
                  <li key={item} className="text-xs leading-relaxed text-slate-400">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                You provide
              </h4>
              <ul className="flex flex-wrap gap-1.5">
                {capability.inputs.map((item) => (
                  <li
                    key={item}
                    className="rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-slate-400"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              How it runs
            </h4>
            <ol className="flex flex-wrap items-center gap-1.5">
              {capability.stages.map((stage, index) => (
                <li key={stage} className="flex items-center gap-1.5">
                  <span className="rounded-md border border-line bg-panel px-2 py-1 text-[11px] text-slate-400">
                    {stage}
                  </span>
                  {index < capability.stages.length - 1 && (
                    <span className="text-[11px] text-slate-600">→</span>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {!planned && capability.examples.length > 0 && (
            <div>
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Try it
              </h4>
              <div className="flex flex-col gap-1.5">
                {capability.examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => onUse(example)}
                    className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-left text-xs text-slate-300 transition hover:border-accent/50 hover:text-white"
                  >
                    <Wand2 className="h-3 w-3 shrink-0 text-mint" />
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/50 pt-3 text-[10px] text-slate-600">
            <span>
              Licence: <span className="text-slate-500">{capability.licence}</span>
            </span>
            <span>Limits: {capability.limits.join(' · ')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Capabilities({ capabilities, onUse }) {
  const grouped = useMemo(() => {
    const map = new Map();
    for (const studio of STUDIOS) map.set(studio.name, []);
    for (const capability of capabilities) {
      if (!map.has(capability.studio)) map.set(capability.studio, []);
      map.get(capability.studio).push(capability);
    }
    return map;
  }, [capabilities]);

  const live = capabilities.filter((capability) => capability.status === 'live').length;

  return (
    <div className="h-[calc(100vh-57px)] overflow-y-auto md:h-screen">
      <header className="border-b border-line/60 px-6 py-5">
        <h1 className="text-sm font-semibold text-white">Capabilities</h1>
        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-slate-500">
          Every engine Studio can drive, grouped by the outcome it produces. {live} live today —
          planned items stay visible so the list grows in the open.
        </p>
      </header>

      <div className="mx-auto max-w-4xl space-y-10 px-4 py-8 sm:px-8">
        {STUDIOS.map(({ name, icon: Icon, blurb }) => {
          const items = grouped.get(name) ?? [];
          if (!items.length) return null;
          return (
            <section key={name}>
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel">
                  <Icon className="h-4 w-4 text-mint" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-white">{name}</h2>
                  <p className="text-[11px] text-slate-500">{blurb}</p>
                </div>
              </div>
              <div className="space-y-3">
                {items.map((capability) => (
                  <CapabilityCard key={capability.id} capability={capability} onUse={onUse} />
                ))}
              </div>
            </section>
          );
        })}

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-white">Growing this list</h2>
          <p className="mt-2 text-xs leading-relaxed text-fog">
            The catalog is a single JSON-shaped module: add an entry to{' '}
            <code className="rounded bg-ink px-1 py-0.5 text-[11px] text-mint">
              apps/api/src/capabilities.ts
            </code>{' '}
            and a matching runner job. The page, the router, and the slash-commands all pick it up
            with no other changes. See{' '}
            <code className="rounded bg-ink px-1 py-0.5 text-[11px] text-mint">
              docs/ADDING_A_CAPABILITY.md
            </code>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
