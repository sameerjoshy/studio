import { useEffect, useState } from 'react';
import { Music, Trash2, Upload, X } from 'lucide-react';
import { api } from '../lib/api.js';

function displayName(name) {
  return name.replace(/^[0-9a-f-]{36}-/i, '').replace(/-/g, ' ');
}

export default function MusicLibrary({ onClose }) {
  const [tracks, setTracks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const data = await api.music();
      setTracks(data.tracks ?? []);
    } catch (err) {
      setError(err.message || 'Could not load the music library.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const signed = await api.presignMusic(file.name, file.size);
      const response = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      await load();
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(name) {
    setBusy(true);
    try {
      await api.deleteMusic(name);
      await load();
    } catch (err) {
      setError(err.message || 'Could not delete the track.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="card max-h-[80vh] w-full max-w-lg overflow-y-auto p-6 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">Music library</h2>
            <p className="mt-1 text-xs text-slate-500">
              Royalty-free tracks for cinematic and hero films. Private, never public.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-5 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-ink/50 px-4 py-5 text-sm text-slate-300 transition hover:border-accent/60">
          <Upload className="h-4 w-4 text-mint" />
          {busy ? 'Working…' : 'Add a track (mp3, wav, m4a, ogg, flac)'}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={busy}
            onChange={upload}
          />
        </label>

        {error && <p className="mb-3 text-xs text-rose-400">{error}</p>}

        {tracks.length === 0 ? (
          <div className="grid place-items-center gap-2 py-8 text-center text-xs text-slate-500">
            <Music className="h-5 w-5 text-slate-600" />
            No tracks yet. Films render silently until you add one.
          </div>
        ) : (
          <ul className="space-y-2">
            {tracks.map((track) => (
              <li
                key={track.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-ink/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-slate-200">
                    {displayName(track.name)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {track.size ? `${(track.size / 1024 / 1024).toFixed(1)} MB` : 'audio'} ·{' '}
                    {new Date(track.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(track.name)}
                  disabled={busy}
                  className="text-slate-500 transition hover:text-rose-400"
                  aria-label="Delete track"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
