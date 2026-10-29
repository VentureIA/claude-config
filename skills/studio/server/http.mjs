// Serveur local du studio : sert l'interface, les médias (avec Range pour la vidéo),
// garde la revue dans <projet>/.studio/review.json et réveille Claude quand on clique « Envoyer ».

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_DIR, GLOBAL_TASTE, MIME, computePeaks, ensureGlobalTaste, filmstrip, expandHome, feedbackMarkdown, mediaKind,
  newId, now, probe, projectTaste, readJSON, readText, reviewFile, serverFile, stableId, studioDir, writeAtomic, CLI,
} from './core.mjs';

const KINDS = ['fix', 'like', 'idea'];
const STATUSES = ['open', 'done', 'wontfix', 'validated'];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function serve({ dir, port: wantedPort, title }) {
  fs.mkdirSync(path.join(studioDir(dir), 'snaps'), { recursive: true });
  ensureGlobalTaste();

  const state = readJSON(reviewFile(dir), null) ?? { version: 1, project: {}, media: [], comments: [], batches: [] };
  state.project = { ...state.project, dir, title: title || state.project.title || path.basename(dir) };

  const sseClients = new Set();
  const waiters = new Set();
  const peaksCache = new Map();
  const filmCache = new Map();
  const watchers = new Map();
  let listening = false;
  let lastWaiterAt = 0;
  let saveTimer = null;
  let port = null;

  const save = () => writeAtomic(reviewFile(dir), JSON.stringify(state, null, 2));
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 120);
  };
  const broadcast = (type) => {
    for (const res of sseClients) res.write(`event: ${type}\ndata: ${Date.now()}\n\n`);
  };
  const changed = (type = 'state') => {
    scheduleSave();
    broadcast(type);
  };

  // Claude « écoute » tant qu'un `studio wait` est branché (il se reconnecte toutes les 50 s).
  const refreshListening = () => {
    if (waiters.size) lastWaiterAt = Date.now();
    const next = waiters.size > 0 || Date.now() - lastWaiterAt < 5000;
    if (next !== listening) {
      listening = next;
      broadcast('state');
    }
  };

  // ------------------------------------------------------------------ médias
  async function describeFile(file) {
    const st = fs.statSync(file);
    return { mtime: st.mtimeMs, size: st.size, ...(await probe(file)) };
  }

  function watchMedia(m) {
    if (m.kind === 'web' || watchers.has(m.id)) return;
    let timer = null;
    const onChange = (cur, prev) => {
      if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size) return;
      clearTimeout(timer);
      // Un rendu écrit le fichier par morceaux : on attend qu'il soit stable.
      timer = setTimeout(async () => {
        if (!fs.existsSync(m.file)) return;
        const info = await describeFile(m.file).catch(() => null);
        if (!info || info.mtime === m.mtime) return;
        Object.assign(m, info, { rev: m.rev + 1, updatedAt: now() });
        peaksCache.delete(m.id);
        changed();
      }, 1500);
    };
    fs.watchFile(m.file, { interval: 1000 }, onChange);
    watchers.set(m.id, () => fs.unwatchFile(m.file, onChange));
  }

  function filesIn(target) {
    if (!fs.statSync(target).isDirectory()) return [target];
    return fs
      .readdirSync(target)
      .filter((name) => !name.startsWith('.') && mediaKind(name))
      .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
      .map((name) => path.join(target, name));
  }

  async function addMedia({ paths = [], urls = [] }) {
    const added = [];
    for (const raw of paths) {
      const target = path.resolve(dir, expandHome(String(raw)));
      if (!fs.existsSync(target)) throw new HttpError(400, `Fichier introuvable : ${target}`);
      for (const file of filesIn(target)) {
        const kind = mediaKind(file);
        if (!kind) throw new HttpError(400, `Format non pris en charge : ${path.basename(file)}`);
        const id = stableId('m_', file);
        let m = state.media.find((x) => x.id === id);
        if (!m) {
          m = { id, kind, file, label: path.basename(file), rev: 1, addedAt: now() };
          state.media.push(m);
        }
        Object.assign(m, await describeFile(file));
        if (kind === 'image') Object.assign(m, { fps: null, duration: null });
        watchMedia(m);
        added.push(m);
      }
    }
    for (const raw of urls) {
      const url = String(raw);
      if (!/^https?:\/\//.test(url)) throw new HttpError(400, `URL invalide : ${url}`);
      const id = stableId('m_', url);
      let m = state.media.find((x) => x.id === id);
      if (!m) {
        m = { id, kind: 'web', url, label: url.replace(/^https?:\/\//, ''), rev: 1, addedAt: now() };
        state.media.push(m);
      }
      added.push(m);
    }
    return added;
  }

  function removeMedia(id) {
    watchers.get(id)?.();
    watchers.delete(id);
    for (const c of state.comments.filter((x) => x.mediaId === id)) dropSnap(c);
    state.comments = state.comments.filter((c) => c.mediaId !== id);
    state.media = state.media.filter((m) => m.id !== id);
  }

  // ------------------------------------------------------------------ commentaires
  const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

  function cleanShape(shape) {
    if (!shape || typeof shape !== 'object') return null;
    switch (shape.type) {
      case 'pin':
        return { type: 'pin', x: clamp01(shape.x), y: clamp01(shape.y) };
      case 'rect':
        return { type: 'rect', x: clamp01(shape.x), y: clamp01(shape.y), w: clamp01(shape.w), h: clamp01(shape.h) };
      case 'arrow':
        return { type: 'arrow', x1: clamp01(shape.x1), y1: clamp01(shape.y1), x2: clamp01(shape.x2), y2: clamp01(shape.y2) };
      case 'path':
        return Array.isArray(shape.points) && shape.points.length > 1
          ? { type: 'path', points: shape.points.slice(0, 2000).map(([x, y]) => [clamp01(x), clamp01(y)]) }
          : null;
      default:
        return null;
    }
  }

  const cleanTags = (tags) => (Array.isArray(tags) ? tags.map(String).map((t) => t.trim()).filter(Boolean).slice(0, 8) : []);

  function createComment(body) {
    const m = state.media.find((x) => x.id === body.mediaId);
    if (!m) throw new HttpError(400, 'Média inconnu');
    const c = {
      id: newId('c_'),
      mediaId: m.id,
      mediaRev: m.rev,
      kind: KINDS.includes(body.kind) ? body.kind : 'fix',
      text: String(body.text ?? '').slice(0, 5000),
      tags: cleanTags(body.tags),
      time: num(body.time),
      end: num(body.end),
      shape: cleanShape(body.shape),
      viewport: body.viewport ? { w: Math.round(body.viewport.w), h: Math.round(body.viewport.h) } : null,
      snap: null,
      status: 'open',
      reply: null,
      batch: null,
      createdAt: now(),
    };
    state.comments.push(c);
    return c;
  }

  function findComment(id) {
    const c = state.comments.find((x) => x.id === id);
    if (!c) throw new HttpError(404, `Commentaire inconnu : ${id}`);
    return c;
  }

  function patchComment(c, body) {
    if (body.text !== undefined && body.text !== c.text) {
      c.text = String(body.text).slice(0, 5000);
      if (c.status === 'open') c.batch = null; // modifié après envoi : il repartira au prochain envoi
    }
    if (body.kind !== undefined && KINDS.includes(body.kind)) c.kind = body.kind;
    if (body.tags !== undefined) c.tags = cleanTags(body.tags);
    if (body.reply !== undefined) {
      c.reply = body.reply ? String(body.reply).slice(0, 5000) : null;
      c.repliedAt = now();
    }
    if (body.status !== undefined && STATUSES.includes(body.status) && body.status !== c.status) {
      if (body.status === 'open' && c.status !== 'open') {
        c.reopened = c.reply;
        c.reply = null;
        c.batch = null;
      }
      c.status = body.status;
    }
    c.updatedAt = now();
  }

  function dropSnap(c) {
    if (c.snap) fs.rmSync(path.join(studioDir(dir), c.snap), { force: true });
  }

  // ------------------------------------------------------------------ envoi à Claude
  function submit() {
    const pending = state.comments.filter((c) => c.batch == null && c.status === 'open');
    if (!pending.length) throw new HttpError(400, 'Aucun nouveau commentaire à envoyer');
    const n = (state.batches.at(-1)?.n ?? 0) + 1;
    for (const c of pending) c.batch = n;
    const batch = { n, at: now(), count: pending.length, delivered: false };
    state.batches.push(batch);
    deliver();
    return batch;
  }

  function deliver() {
    const batches = state.batches.filter((b) => !b.delivered);
    if (!batches.length || !waiters.size) return;
    const numbers = batches.map((b) => b.n);
    const comments = state.comments.filter((c) => numbers.includes(c.batch) && c.status === 'open');
    const title = `Retours du studio · ${state.project.title} · série ${numbers.join(', ')}`;
    const payload = { batches: numbers, markdown: feedbackMarkdown(state, comments, title) };
    for (const w of waiters) {
      clearTimeout(w.timer);
      sendJSON(w.res, 200, payload);
    }
    waiters.clear();
    for (const b of batches) Object.assign(b, { delivered: true, deliveredAt: now() });
    changed();
  }

  function waitForBatch(res, seconds) {
    const waiter = {
      res,
      timer: setTimeout(() => {
        waiters.delete(waiter);
        res.writeHead(204).end();
        refreshListening();
      }, seconds * 1000),
    };
    waiters.add(waiter);
    res.on('close', () => {
      if (waiters.delete(waiter)) clearTimeout(waiter.timer);
      refreshListening();
    });
    refreshListening();
    deliver();
  }

  // ------------------------------------------------------------------ HTTP
  const publicState = () => ({
    ...state,
    listening,
    cli: CLI,
    taste: {
      global: { path: GLOBAL_TASTE, text: readText(GLOBAL_TASTE) },
      project: { path: projectTaste(dir), text: readText(projectTaste(dir)) },
    },
  });

  async function api(req, res, url) {
    const [route, id] = url.pathname.slice('/api/'.length).split('/').map(decodeURIComponent);
    const method = req.method;

    if (method === 'GET' && route === 'ping') return sendJSON(res, 200, { ok: true, dir, pid: process.pid, port });
    if (method === 'GET' && route === 'state') return sendJSON(res, 200, publicState());
    if (method === 'GET' && route === 'events') return openEvents(res);
    if (method === 'GET' && route === 'wait') return waitForBatch(res, Math.min(300, Number(url.searchParams.get('t')) || 50));

    if (method === 'GET' && route === 'peaks') {
      const m = state.media.find((x) => x.id === id);
      if (!m?.file) throw new HttpError(404, 'Média inconnu');
      if (!peaksCache.has(m.id)) peaksCache.set(m.id, computePeaks(m.file).catch(() => []));
      return sendJSON(res, 200, { rev: m.rev, peaks: await peaksCache.get(m.id) });
    }

    if (method === 'GET' && route === 'film') {
      const m = state.media.find((x) => x.id === id);
      if (!m?.file || m.kind !== 'video' || !m.duration) throw new HttpError(404, 'Pas de pellicule pour ce média');
      const count = Math.min(200, Math.max(1, Number(url.searchParams.get('count')) || 30));
      const height = Math.min(240, Math.max(16, Number(url.searchParams.get('h')) || 88));
      const key = `${m.id}:${m.rev}:${count}:${height}`;
      if (!filmCache.has(key)) {
        if (filmCache.size > 40) filmCache.clear();
        filmCache.set(key, filmstrip(m.file, m.duration, count, height).catch(() => null));
      }
      const png = await filmCache.get(key);
      if (!png?.length) throw new HttpError(500, 'Pellicule indisponible (ffmpeg ?)');
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(png);
    }

    if (method === 'POST' && route === 'media') {
      const added = await addMedia(await readJSONBody(req));
      changed();
      return sendJSON(res, 200, { added });
    }
    if (method === 'DELETE' && route === 'media') {
      removeMedia(id);
      changed();
      return sendJSON(res, 200, { ok: true });
    }

    if (method === 'POST' && route === 'comments') {
      const c = createComment(await readJSONBody(req));
      changed();
      return sendJSON(res, 201, c);
    }
    if (method === 'PATCH' && route === 'comments') {
      const c = findComment(id);
      patchComment(c, await readJSONBody(req));
      changed();
      return sendJSON(res, 200, c);
    }
    if (method === 'DELETE' && route === 'comments') {
      const c = findComment(id);
      dropSnap(c);
      state.comments = state.comments.filter((x) => x !== c);
      changed();
      return sendJSON(res, 200, { ok: true });
    }

    if (method === 'POST' && route === 'snap') {
      const c = findComment(id);
      const png = await readBody(req);
      if (png.subarray(1, 4).toString() !== 'PNG') throw new HttpError(400, 'PNG attendu');
      c.snap = `snaps/${c.id}.png`;
      fs.writeFileSync(path.join(studioDir(dir), c.snap), png);
      changed();
      return sendJSON(res, 200, { snap: c.snap });
    }

    if (method === 'POST' && route === 'submit') {
      const batch = submit();
      changed();
      return sendJSON(res, 200, { batch, listening });
    }

    if (method === 'GET' && route === 'pending') {
      const comments = state.comments.filter((c) => c.status === 'open');
      return sendJSON(res, 200, { markdown: feedbackMarkdown(state, comments, `Retours ouverts · ${state.project.title}`) });
    }

    if (method === 'PUT' && route === 'taste') {
      const file = id === 'project' ? projectTaste(dir) : GLOBAL_TASTE;
      writeAtomic(file, (await readBody(req)).toString('utf8'));
      broadcast('taste');
      return sendJSON(res, 200, { ok: true });
    }

    if (method === 'POST' && route === 'stop') {
      sendJSON(res, 200, { ok: true });
      return shutdown();
    }

    throw new HttpError(404, 'Route inconnue');
  }

  function openEvents(res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1500\n\n');
    sseClients.add(res);
    res.on('close', () => sseClients.delete(res));
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!LOCAL_HOST.test(req.headers.host || '')) throw new HttpError(403, 'Hôte refusé');
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      const read = req.method === 'GET' || req.method === 'HEAD';

      if (p.startsWith('/api/')) return await api(req, res, url);
      if (read && (p === '/' || p === '/index.html')) return sendFile(req, res, path.join(APP_DIR, 'index.html'));
      if (read && p.startsWith('/app/')) return sendFile(req, res, safeJoin(APP_DIR, p.slice('/app/'.length)));
      if (read && p.startsWith('/snaps/')) return sendFile(req, res, safeJoin(path.join(studioDir(dir), 'snaps'), p.slice('/snaps/'.length)));
      if (read && p.startsWith('/media/')) {
        const m = state.media.find((x) => x.id === decodeURIComponent(p.slice('/media/'.length)));
        if (!m?.file) throw new HttpError(404, 'Média inconnu');
        return sendFile(req, res, m.file);
      }
      throw new HttpError(404, 'Introuvable');
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      sendJSON(res, err.status || 500, { error: err.message });
    }
  });
  server.requestTimeout = 0; // les écoutes de Claude et le flux d'événements restent ouverts longtemps

  function shutdown() {
    clearTimeout(saveTimer);
    save();
    for (const stop of watchers.values()) stop();
    for (const res of sseClients) res.end();
    const info = readJSON(serverFile(dir), null);
    if (info?.pid === process.pid) fs.rmSync(serverFile(dir), { force: true });
    server.close();
    setTimeout(() => process.exit(0), 200).unref();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  for (const m of state.media) {
    if (m.file && fs.existsSync(m.file)) watchMedia(m);
  }
  // Claude écrit dans les fichiers de goûts : l'onglet Goûts se met à jour tout seul.
  for (const file of [GLOBAL_TASTE, projectTaste(dir)]) {
    const onTaste = (cur, prev) => cur.mtimeMs !== prev.mtimeMs && broadcast('taste');
    fs.watchFile(file, { interval: 1000 }, onTaste);
    watchers.set(file, () => fs.unwatchFile(file, onTaste));
  }
  setInterval(refreshListening, 2000).unref();
  setInterval(() => {
    for (const res of sseClients) res.write(': ping\n\n');
  }, 25000).unref();

  port = await listen(server, wantedPort);
  save();
  writeAtomic(serverFile(dir), JSON.stringify({ port, pid: process.pid, dir, startedAt: now() }, null, 2));
  console.log(`[studio] ${state.project.title} sur http://localhost:${port}/ (pid ${process.pid})`);
}

// ------------------------------------------------------------------ utilitaires HTTP

function listen(server, firstPort, attempts = 20) {
  return new Promise((resolve, reject) => {
    const tryPort = (p, left) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && left > 0) tryPort(p + 1, left - 1);
        else reject(err);
      };
      server.once('error', onError);
      server.listen(p, '127.0.0.1', () => {
        server.off('error', onError);
        resolve(server.address().port); // un essai précédent qui a échoué laisse aussi son rappel : on lit le vrai port
      });
    };
    tryPort(firstPort, attempts);
  });
}

function safeJoin(base, rel) {
  const file = path.resolve(base, decodeURIComponent(rel));
  if (!file.startsWith(base + path.sep)) throw new HttpError(403, 'Chemin refusé');
  return file;
}

function sendJSON(res, status, body) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 40 << 20) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Fichier trop lourd');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJSONBody(req) {
  const body = await readBody(req);
  try {
    return body.length ? JSON.parse(body.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}

function sendFile(req, res, file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw new HttpError(404, 'Fichier introuvable');
  }
  const headers = {
    'Content-Type': MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] === '' ? null : Number(range[1]);
    let end = range[2] === '' ? null : Number(range[2]);
    if (start === null) {
      start = Math.max(0, st.size - end);
      end = st.size - 1;
    } else if (end === null || end >= st.size) {
      end = st.size - 1;
    }
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
