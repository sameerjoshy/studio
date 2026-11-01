import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Inbox, MessageSquarePlus } from 'lucide-react';
import JobCard from './JobCard.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'complete', label: 'Complete' },
  { id: 'active', label: 'Running' },
  { id: 'error', label: 'Failed' },
];

export default function Library({ jobs, capabilities, onOpen, onGoToChat }) {
  const [filter, setFilter] = useState('all');

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
              <div
                key={job.id}
                onMouseEnter={() => {
                  if (!job.events && onOpen) onOpen(job.id);
                }}
              >
                <JobCard
                  job={job}
                  capability={capabilityById.get(job.capability)}
                  onRetry={async () => {
                    /* handled through the chat surface */
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
