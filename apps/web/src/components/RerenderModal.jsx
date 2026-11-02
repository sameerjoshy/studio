import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { api } from '../lib/api.js';

function TextField({ label, value, onChange, multiline = false }) {
  return (
    <label className="block text-[11px] text-slate-500">
      {label}
      {multiline ? (
        <textarea
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className="mt-1 w-full resize-none rounded-lg border border-line bg-ink px-3 py-2 text-xs text-white"
        />
      ) : (
        <input
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2 text-xs text-white"
        />
      )}
    </label>
  );
}

export default function RerenderModal({ job, capability, onClose, onCreated }) {
  const [spec, setSpec] = useState(() => JSON.parse(JSON.stringify(job.spec ?? {})));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isDeck = capability.id === 'deck-native';
  const isFilm = capability.id === 'film-brand';

  const set = (key, value) => setSpec((previous) => ({ ...previous, [key]: value }));

  const setSlide = (index, patch) =>
    setSpec((previous) => {
      const slides = [...(previous.slides ?? [])];
      slides[index] = { ...slides[index], ...patch };
      return { ...previous, slides };
    });

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { job: next } = await api.rerender(job.id, spec);
      onCreated(next);
    } catch (err) {
      setError(err.message || 'Could not re-render.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="card max-h-[86vh] w-full max-w-2xl overflow-y-auto p-6 shadow-panel"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">Edit &amp; re-render</h2>
            <p className="mt-1 text-xs text-slate-500">
              No new planning call. Copy is re-scored and the file is rebuilt.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <TextField label="Title" value={spec.title} onChange={(value) => set('title', value)} />
          <TextField
            label="Subtitle"
            value={spec.subtitle}
            onChange={(value) => set('subtitle', value)}
          />

          {isFilm && (
            <>
              {[0, 1, 2].map((index) => (
                <TextField
                  key={index}
                  label={`Line ${index + 1}`}
                  value={(spec.bullets ?? [])[index]}
                  onChange={(value) => {
                    const bullets = [...(spec.bullets ?? ['', '', ''])];
                    bullets[index] = value;
                    set('bullets', bullets);
                  }}
                />
              ))}
              <label className="flex items-center gap-3 text-[11px] text-slate-500">
                Accent
                <input
                  type="color"
                  value={spec.accent || '#34D399'}
                  onChange={(event) => set('accent', event.target.value)}
                  className="h-8 w-12 rounded border border-line bg-ink"
                />
              </label>
            </>
          )}

          {isDeck && (
            <div className="space-y-4 border-t border-line/60 pt-4">
              {(spec.slides ?? []).map((slide, index) => (
                <div key={index} className="rounded-lg border border-line/60 bg-ink/40 p-3">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Slide {index + 1}
                  </div>
                  <TextField
                    label="Title"
                    value={slide.title}
                    onChange={(value) => setSlide(index, { title: value })}
                  />
                  <div className="mt-2">
                    <TextField
                      label="Bullets (one per line)"
                      value={(slide.bullets ?? []).join('\n')}
                      onChange={(value) =>
                        setSlide(index, {
                          bullets: value
                            .split('\n')
                            .map((line) => line.trim())
                            .filter(Boolean),
                        })
                      }
                      multiline
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary mt-5 w-full">
          <RefreshCw className="h-4 w-4" />
          {busy ? 'Starting…' : 'Re-render'}
        </button>
      </form>
    </div>
  );
}
