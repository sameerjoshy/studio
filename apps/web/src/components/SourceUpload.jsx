import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Upload, X } from 'lucide-react';
import { api } from '../lib/api.js';

const MAX_BYTES = 250 * 1024 * 1024;

const LANGUAGES = [
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
];

export default function SourceUpload({ capabilities, onCreated, onClose }) {
  const options = useMemo(
    () => capabilities.filter((capability) => capability.requiresSource),
    [capabilities],
  );

  const [file, setFile] = useState(null);
  const [capabilityId, setCapabilityId] = useState(options[0]?.id ?? 'film-talking-head');
  const [brief, setBrief] = useState('');
  const [language, setLanguage] = useState('es');
  const [engine, setEngine] = useState('kokoro');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');

  const capability = options.find((item) => item.id === capabilityId);

  async function submit(event) {
    event.preventDefault();
    if (!file || busy) return;

    if (file.size > MAX_BYTES) {
      setError('That file is over the 250 MB limit.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      setStage('Preparing upload');
      const signed = await api.presignUpload(file.name, file.size);

      setStage('Uploading source');
      const upload = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!upload.ok) throw new Error(`Upload failed (${upload.status})`);

      setStage('Starting the job');
      const spec = {
        source_path: signed.path,
        brief: brief.trim(),
        seconds: 90,
        ...(capabilityId === 'film-dub' ? { language, engine } : {}),
      };
      const { job } = await api.run(capabilityId, spec);

      onCreated(job, `Uploaded ${file.name} - running ${capability?.name ?? capabilityId}.`);
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setBusy(false);
      setStage('');
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
      <form onSubmit={submit} className="card w-full max-w-lg p-6 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">Upload a source</h2>
            <p className="mt-1 text-xs text-slate-500">
              Video or audio, up to 250 MB. The file is deleted after the job.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-4 block cursor-pointer rounded-xl border border-dashed border-line bg-ink/50 px-4 py-6 text-center transition hover:border-accent/60">
          <Upload className="mx-auto h-5 w-5 text-mint" />
          <div className="mt-2 text-sm text-slate-300">
            {file ? file.name : 'Choose a video or audio file'}
          </div>
          <div className="mt-1 text-[11px] text-slate-600">
            {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'mp4, mov, webm, mkv, mp3, wav, m4a'}
          </div>
          <input
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <fieldset className="mb-4">
          <legend className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Pipeline
          </legend>
          <div className="grid max-h-48 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCapabilityId(option.id)}
                className={clsx(
                  'rounded-lg border px-3 py-2 text-left text-xs transition',
                  capabilityId === option.id
                    ? 'border-accent/60 bg-accent/15 text-white'
                    : 'border-line bg-panel text-slate-300 hover:border-slate-500',
                )}
              >
                <span className="block font-semibold">{option.name}</span>
                <span className="mt-0.5 block text-[10px] text-slate-500">{option.estTime}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {capabilityId === 'film-dub' && (
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <label className="text-[11px] text-slate-500">
              Language
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-ink px-2 py-2 text-xs text-white"
              >
                {LANGUAGES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 text-[11px] text-slate-500">
              Voice engine
              <select
                value={engine}
                onChange={(event) => setEngine(event.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-ink px-2 py-2 text-xs text-white"
              >
                <option value="kokoro">Kokoro (Apache-2.0)</option>
                <option value="xtts">XTTS (non-commercial)</option>
              </select>
            </label>
          </div>
        )}

        <label className="mb-4 block text-[11px] text-slate-500">
          What should the edit focus on? (optional)
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={2}
            placeholder="Keep the strongest 60 seconds about the launch."
            className="mt-1 w-full resize-none rounded-lg border border-line bg-ink px-3 py-2 text-xs text-white placeholder:text-slate-600"
          />
        </label>

        {error && <p className="mb-3 text-xs text-rose-400">{error}</p>}
        {busy && <p className="mb-3 text-xs text-mint">{stage}...</p>}

        <button
          type="submit"
          disabled={!file || busy}
          className="btn-primary w-full disabled:opacity-40"
        >
          {busy ? 'Working...' : 'Upload and run'}
        </button>
      </form>
    </div>
  );
}
