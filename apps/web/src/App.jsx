import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { useJobs } from './lib/useJobs.js';
import Shell from './components/Shell.jsx';
import Chat from './components/Chat.jsx';
import Capabilities from './components/Capabilities.jsx';
import Library from './components/Library.jsx';

export default function App() {
  const [tab, setTab] = useState('chat');
  const [capabilities, setCapabilities] = useState([]);
  const [prefill, setPrefill] = useState('');
  const { jobs, addJob, refresh, fetchDetail } = useJobs();

  useEffect(() => {
    api
      .capabilities()
      .then((data) => setCapabilities(data.capabilities ?? []))
      .catch(() => setCapabilities([]));
    refresh();
  }, [refresh]);

  const usePrompt = useCallback((prompt) => {
    setPrefill(prompt);
    setTab('chat');
  }, []);

  return (
    <Shell tab={tab} setTab={setTab}>
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
          onCreated={addJob}
        />
      )}
    </Shell>
  );
}
