import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Inbox, MessageSquarePlus, PencilRuler } from 'lucide-react';
import { api } from '../lib/api.js';
import JobCard from './JobCard.jsx';
import RerenderModal from './RerenderModal.jsx';

const RERENDERABLE = new Set(['deck-native', 'film-brand']);

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'complete', label: 'Complete' },
  { id: 'active', label: 'Running' },
  { id: 'error', label: 'Failed' },
];

export default function Library({ jobs, capabilities, onOpen, onGoToChat, onCreated }) {
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);

  const capabilityById = useMemo(() => {
    const map = new Map();
    for (const capability of capabilities) map.set(capability.id, capability);
    return map;
  }, [capabilities]);

  const filtered = useMemo(() => {
    if (filter === 'all') return jobs;
    if (filter === 'active') {
      return jobs.filter((job) => ['queued', 'dispatched', 'running'].includes(job.status));
    }
    return jobs.filter((job) => job.status === filter);
  }, [filter, jobs]);

  useEffect(() => {
    const missing = jobs.filter((job) => job.status === 'complete' && !job.url).slice(0, 20);
    for (const job of missing) onOpen?.(job.id);
  }, [jobs, onOpen]);

  async function retry(id) {
    try {
      await api.retry(id);
      await onOpen?.(id);
    } catch {
      /* surfaced by the next poll */
    }
  }

  return (
    <div className="h-[calc(100vh-57px)] overflow-y-auto md:h-screen">
      <header className="border-b border-line/60 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold text-white">Library</h1>
            <p className="mt-1 text-[11px] text-slate-500">
              Every job you have run, with its file and runner log.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-line bg-panel p-1">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-[11px] font-medium transition',
                  filter === item.id
                    ? 'bg-accent/20 text-white'
                    : 'text-slate-500 hover:text-slate-300',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        {filtered.length === 0 ? (
          <div className="card grid place-items-center gap-3 p-12 text-center">
            <Inbox className="h-6 w-6 text-slate-600" />
            <p className="text-sm text-slate-400">Nothing here yet.</p>
            <button type="button" onClick={() => onGoToChat('')} className="btn-ghost text-xs">
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Open the Control Room
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((job) => (
              <div key={job.id} className="space-y-2">
                <JobCard
                  job={job}
                  capability={capabilityById.get(job.capability)}
                  onRetry={retry}
                />
                {RERENDERABLE.has(job.capability) && job.status === 'complete' && (
                  <button
                    type="button"
                    onClick={() => setEditing(job)}
                    className="btn-ghost !py-1.5 text-xs"
                  >
                    <PencilRuler className="h-3.5 w-3.5" />
                    Edit &amp; re-render
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <RerenderModal
          job={editing}
          capability={capabilityById.get(editing.capability)}
          onClose={() => setEditing(null)}
          onCreated={(job) => {
            setEditing(null);
            onCreated?.(job);
          }}
        />
      )}
    </div>
  );
}
