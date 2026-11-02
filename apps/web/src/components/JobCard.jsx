import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Clock, Download, Loader2, RefreshCw } from 'lucide-react';

const STATUS = {
  queued: { label: 'Queued', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  dispatched: { label: 'Starting runner', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  running: { label: 'Running', tone: 'border-indigo-400/30 bg-indigo-500/10 text-indigo-300' },
  complete: { label: 'Complete', tone: 'border-mint/30 bg-mint/10 text-mint' },
  error: { label: 'Failed', tone: 'border-rose-500/30 bg-rose-500/10 text-rose-300' },
  killed: { label: 'Stopped', tone: 'border-slate-500/30 bg-slate-500/10 text-slate-300' },
};

export default function JobCard({ job, capability, url, onRetry, compact = false }) {
  const status = STATUS[job.status] ?? STATUS.queued;
  const outputUrl = url || job.url;
  const name = job.output_name || '';
  const isAudio = /\.(wav|mp3|m4a)$/i.test(name);
  const isVideo = /\.(mp4|webm|mov)$/i.test(name);
  const active = ['queued', 'dispatched', 'running'].includes(job.status);
  const events = (job.events ?? []).slice(-4);

  return (
    <div className={clsx('card overflow-hidden', compact ? 'p-4' : 'p-5')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={clsx('pill', status.tone)}>
            {job.status === 'complete' && <CheckCircle2 className="h-3 w-3" />}
            {job.status === 'error' && <AlertCircle className="h-3 w-3" />}
            {active && <Loader2 className="h-3 w-3 animate-spin" />}
            {status.label}
          </span>
          <span className="text-sm font-semibold text-white">
            {capability?.name ?? job.capability}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          {typeof job.meta?.slop?.score === 'number' ? (
            <span
              className={clsx(
                'pill',
                job.meta.slop.score >= 40
                  ? 'border-mint/30 bg-mint/10 text-mint'
                  : job.meta.slop.score >= 30
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-300',
              )}
              title={
                Array.isArray(job.meta.slop.issues) && job.meta.slop.issues.length
                  ? job.meta.slop.issues.map((issue) => issue.detail).join(', ')
                  : 'Copy score'
              }
            >
              Copy {job.meta.slop.score}
            </span>
          ) : null}
          {job.meta?.cost_usd ? <span>${Number(job.meta.cost_usd).toFixed(4)}</span> : null}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {active && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-mint transition-all duration-500"
              style={{ width: `${Math.max(4, job.progress ?? 4)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>{job.stage ? job.stage.replace(/-/g, ' ') : 'waiting for a runner'}</span>
            <span>{job.progress ?? 0}%</span>
          </div>
        </div>
      )}

      {job.status === 'error' && (
        <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
          <p className="font-mono text-[11px] leading-relaxed text-rose-300">
            {(job.error ?? 'The runner failed.').slice(0, 400)}
          </p>
          {onRetry && (
            <button type="button" onClick={() => onRetry(job.id)} className="btn-ghost mt-2 !py-1.5 text-xs">
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          )}
        </div>
      )}

      {outputUrl && (
        <div className="mt-4 space-y-3">
          {isAudio && <audio controls src={outputUrl} className="w-full" />}
          {isVideo && (
            <video controls src={outputUrl} className="w-full rounded-xl border border-line" />
          )}
          <a
            href={outputUrl}
            download={name || undefined}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost w-full !py-2 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            Download {name || 'output'}
          </a>
        </div>
      )}

      {events.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-[11px] font-medium text-slate-500 hover:text-slate-300">
            Runner log ({events.length})
          </summary>
          <ul className="mt-2 space-y-1 border-l border-line pl-3">
            {events.map((event) => (
              <li key={event.id} className="font-mono text-[10px] leading-relaxed text-slate-500">
                <span
                  className={clsx(
                    event.level === 'error' && 'text-rose-400',
                    event.level === 'warn' && 'text-amber-400',
                  )}
                >
                  [{event.stage ?? 'log'}]
                </span>{' '}
                {event.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
