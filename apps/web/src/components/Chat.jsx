import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Command, Music2, Paperclip, Sparkles, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import JobCard from './JobCard.jsx';
import MusicLibrary from './MusicLibrary.jsx';
import SourceUpload from './SourceUpload.jsx';

const STORAGE_KEY = 'studio.chat.v1';

function loadMessages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function Chat({ capabilities, jobs, onJob, prefill, onPrefillUsed, onOpenCapabilities }) {
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showMusic, setShowMusic] = useState(false);
  const bottomRef = useRef(null);

  const byId = useMemo(() => {
    const map = new Map();
    for (const capability of capabilities) map.set(capability.id, capability);
    return map;
  }, [capabilities]);

  const jobById = useMemo(() => {
    const map = new Map();
    for (const job of jobs) map.set(job.id, job);
    return map;
  }, [jobs]);

  const suggestions = useMemo(
    () =>
      capabilities
        .filter((capability) => capability.status === 'live')
        .flatMap((capability) => capability.examples.slice(0, 2))
        .slice(0, 4),
    [capabilities],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending, jobs]);

  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      onPrefillUsed?.();
    }
  }, [prefill, onPrefillUsed]);

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || sending) return;

    const history = [...messages, { role: 'user', content }];
    setMessages(history);
    setInput('');
    setSending(true);

    try {
      const response = await api.chat(
        history.map((message) => ({ role: message.role, content: message.content })),
      );

      setMessages((previous) => [
        ...previous,
        { role: 'assistant', content: response.reply || 'On it.', jobId: response.job?.id },
      ]);

      if (response.job) onJob(response.job);
    } catch (error) {
      setMessages((previous) => [
        ...previous,
        { role: 'assistant', content: `That did not go through: ${error.message}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col md:h-screen">
      <header className="flex items-center justify-between border-b border-line/60 px-6 py-4">
        <div>
          <h1 className="text-sm font-semibold text-white">Control Room</h1>
          <p className="text-[11px] text-slate-500">
            Describe an outcome. Studio picks the tool, runs it, returns the file.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="btn-ghost !py-1.5 text-xs"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Upload source
          </button>
          <button
            type="button"
            onClick={() => setShowMusic(true)}
            className="btn-ghost !py-1.5 text-xs"
            aria-label="Music library"
          >
            <Music2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onOpenCapabilities} className="btn-ghost !py-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            What can it do
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-3xl space-y-5">
          {empty && (
            <div className="space-y-6">
              <div className="card p-6">
                <h2 className="text-xl font-bold tracking-tight text-white">
                  What do you want to make?
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-fog">
                  Decks, brand films, and narration — generated on free remote compute and delivered
                  here. Nothing runs on your machine.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    className="card p-4 text-left text-sm text-slate-300 transition hover:border-accent/50 hover:text-white"
                  >
                    <span className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      <Command className="h-3 w-3" />
                      Try
                    </span>
                    {suggestion}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowUpload(true)}
                className="card flex w-full items-center gap-3 p-4 text-left transition hover:border-mint/50"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-ink">
                  <Upload className="h-4 w-4 text-mint" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">
                    Have footage or audio?
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Upload it to auto-caption, cut, clip, dub, or repurpose it.
                  </span>
                </span>
              </button>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className="space-y-3">
              <div
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-3 text-sm text-white'
                    : 'max-w-[92%] rounded-2xl rounded-bl-md border border-line/70 bg-panel/80 px-4 py-3 text-sm leading-relaxed text-slate-200'
                }
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>

              {message.jobId && jobById.get(message.jobId) && (
                <JobCard
                  job={jobById.get(message.jobId)}
                  capability={byId.get(jobById.get(message.jobId).capability)}
                  compact
                  onRetry={async (id) => {
                    try {
                      await api.retry(id);
                    } catch {
                      /* surfaced by the next poll */
                    }
                  }}
                />
              )}
            </div>
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint" />
              Routing to a studio…
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-line/60 bg-ink/60 px-4 py-4 backdrop-blur sm:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel px-3 py-2 focus-within:border-accent/70">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Make a 6-slide deck on pipeline hygiene…"
              className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={sending || !input.trim()}
              className="btn-primary h-9 w-9 !rounded-xl !p-0"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-slate-600">
            Enter to send · Shift+Enter for a new line · jobs run on free remote compute
          </p>
        </div>
      </div>

      {showMusic && <MusicLibrary onClose={() => setShowMusic(false)} />}

      {showUpload && (
        <SourceUpload
          capabilities={capabilities}
          onClose={() => setShowUpload(false)}
          onCreated={(job, message) => {
            setShowUpload(false);
            setMessages((previous) => [...previous, { role: 'assistant', content: message, jobId: job.id }]);
            onJob(job);
          }}
        />
      )}
    </div>
  );
}
