import { useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { api } from '../lib/api.js';

export default function AuthGate({ onDone }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!passphrase.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.auth(passphrase.trim());
      onDone();
    } catch (err) {
      setError(err.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <svg viewBox="0 0 100 60" className="h-9 w-14" aria-hidden="true">
            <path d="M6 5 L46 30 L6 55 Z" fill="#34D399" />
            <path d="M94 5 L54 30 L94 55 Z" fill="#ffffff" />
          </svg>
          <div>
            <div className="text-lg font-extrabold tracking-wide">GTM-360</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-mint">
              Studio
            </div>
          </div>
        </div>

        <div className="card p-7 shadow-panel">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
            <LockKeyhole className="h-4 w-4 text-mint" />
            Private control room
          </div>
          <p className="mb-6 text-sm leading-relaxed text-fog">
            Studio runs on free remote compute. Enter the passphrase to open the chat.
          </p>

          <form onSubmit={submit} className="space-y-3">
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="Passphrase"
              autoFocus
              className="w-full rounded-xl border border-line bg-ink/70 px-4 py-3 text-sm text-white outline-none transition focus:border-accent"
            />
            {error && <p className="text-xs text-rose-400">{error}</p>}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? 'Checking…' : 'Enter Studio'}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-500">
          Decks · Films · Voices — all open source, all free to run.
        </p>
      </div>
    </div>
  );
}
