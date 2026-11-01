import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { useJobs } from './lib/useJobs.js';
import AuthGate from './components/AuthGate.jsx';
import Shell from './components/Shell.jsx';
import Chat from './components/Chat.jsx';
import Capabilities from './components/Capabilities.jsx';
import Library from './components/Library.jsx';

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [tab, setTab] = useState('chat');
  const [capabilities, setCapabilities] = useState([]);
  const [prefill, setPrefill] = useState('');
  const { jobs, addJob, refresh, fetchDetail } = useJobs();

  useEffect(() => {
    api
      .session()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (!authed) return;
    api
      .capabilities()
      .then((data) => setCapabilities(data.capabilities ?? []))
      .catch(() => setCapabilities([]));
    refresh();
  }, [authed, refresh]);

  const usePrompt = useCallback((prompt) => {
    setPrefill(prompt);
    setTab('chat');
  }, []);

  if (authed === null) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-fog">Opening Studio…</div>
    );
  }

  if (!authed) {
    return <AuthGate onDone={() => setAuthed(true)} />;
  }

  return (
    <Shell tab={tab} setTab={setTab} onSignOut={() => setAuthed(false)}>
      {tab === 'chat' && (
        <Chat
          capabilities={capabilities}
          jobs={jobs}
          onJob={addJob}
          prefill={prefill}
          onPrefillUsed={() => setPrefill('')}
          onOpenCapabilities={() => setTab('capabilities')}
        />
      )}
      {tab === 'capabilities' && <Capabilities capabilities={capabilities} onUse={usePrompt} />}
      {tab === 'library' && (
        <Library
          jobs={jobs}
          capabilities={capabilities}
          onOpen={fetchDetail}
          onGoToChat={usePrompt}
        />
      )}
    </Shell>
  );
}
