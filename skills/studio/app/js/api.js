// Accès au serveur local du studio.

async function call(method, url, { json, blob, text } = {}) {
  const init = { method, headers: {} };
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (blob) {
    init.headers['Content-Type'] = blob.type || 'application/octet-stream';
    init.body = blob;
  } else if (text !== undefined) {
    init.headers['Content-Type'] = 'text/plain; charset=utf-8';
    init.body = text;
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export const api = {
  state: () => call('GET', '/api/state'),
  addMedia: (paths, urls) => call('POST', '/api/media', { json: { paths, urls } }),
  removeMedia: (id) => call('DELETE', `/api/media/${encodeURIComponent(id)}`),
  createComment: (comment) => call('POST', '/api/comments', { json: comment }),
  patchComment: (id, patch) => call('PATCH', `/api/comments/${encodeURIComponent(id)}`, { json: patch }),
  deleteComment: (id) => call('DELETE', `/api/comments/${encodeURIComponent(id)}`),
  uploadSnap: (id, blob) => call('POST', `/api/snap/${encodeURIComponent(id)}`, { blob }),
  submit: () => call('POST', '/api/submit'),
  peaks: (id) => call('GET', `/api/peaks/${encodeURIComponent(id)}`),
  saveTaste: (scope, text) => call('PUT', `/api/taste/${scope}`, { text }),
};

// Le serveur prévient quand la revue change (réponse de Claude, nouveau rendu, goûts modifiés).
export function listen(onEvent) {
  const source = new EventSource('/api/events');
  source.addEventListener('state', () => onEvent('state'));
  source.addEventListener('taste', () => onEvent('taste'));
  source.addEventListener('open', () => onEvent('open'));
  source.addEventListener('error', () => onEvent('offline'));
  return source;
}
