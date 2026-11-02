// Studio is served both at the Worker root and behind apps.gtm-360.com/studio,
// where the hub strips the prefix before forwarding. Keep the browser calls on
// whichever prefix the page was loaded from.
const PREFIX = window.location.pathname.startsWith('/studio') ? '/studio' : '';

async function request(path, init = {}) {
  const response = await fetch(`${PREFIX}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

export const api = {
  capabilities: () => request('/api/capabilities'),
  chat: (messages) => request('/api/chat', { method: 'POST', body: JSON.stringify({ messages }) }),
  jobs: () => request('/api/jobs'),
  job: (id) => request(`/api/jobs/${id}`),
  retry: (id) => request(`/api/jobs/${id}/retry`, { method: 'POST' }),
};
