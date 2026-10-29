// Point d'entrée : relie la scène, la timeline, le panneau, les goûts et le serveur.

import { api, listen } from './api.js';
import { createPanel } from './comments.js';
import { createStage } from './stage.js';
import { createTasteView } from './taste.js';
import { createTimeline } from './timeline.js';
import { $, TOOLS, canDraw, frameOf, h, hasTime, icon, isTyping, timecode, toast } from './util.js';

const app = {
  data: null,
  mediaId: decodeURIComponent(location.hash.slice(1)) || null,
  tool: 'select',
  selectedId: null,
  draft: null,
  tab: 'review',
  numbers: new Map(),
};
const seenRevs = new Map();

const stage = createStage($('#stage'), {
  onDraft: startDraft,
  onSelect: select,
  onReady: () => refreshVisible(true),
});
const timeline = createTimeline($('#timeline'), {
  player: stage.player,
  onRange: renderTransport,
  onSelect: select,
});
const panel = createPanel($('#panel'), {
  onSave: saveDraft,
  onCancel: cancelDraft,
  onDraftKind: (kind) => {
    if (!app.draft) return;
    app.draft.kind = kind;
    refreshVisible(true);
  },
  onSelect: select,
  onPatch: (id, patch) => api.patchComment(id, patch).then(refresh).catch((e) => toast(e.message, 'error')),
  onDelete: (id) => api.deleteComment(id).then(refresh).catch((e) => toast(e.message, 'error')),
  onRefresh: () => render(),
});
const tasteView = createTasteView($('#view-taste'), {
  onSave: (scope, text) => api.saveTaste(scope, text).then(refresh).catch((e) => toast(e.message, 'error')),
});

const currentMedia = () => app.data?.media.find((m) => m.id === app.mediaId) ?? null;
const mediaComments = () => app.data?.comments.filter((c) => c.mediaId === app.mediaId) ?? [];

function numbering(list) {
  const sorted = [...list].sort((a, b) => (a.time ?? -1) - (b.time ?? -1) || a.createdAt.localeCompare(b.createdAt));
  return new Map(sorted.map((c, i) => [c.id, i + 1]));
}

// ------------------------------------------------------------------ données
let refreshTimer = null;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 60);
}

async function refresh() {
  try {
    app.data = await api.state();
    document.body.dataset.offline = 'false';
  } catch {
    document.body.dataset.offline = 'true';
    renderHeader();
    return;
  }
  if (!currentMedia()) app.mediaId = app.data.media.at(-1)?.id ?? null;
  render();
}

// ------------------------------------------------------------------ rendu
function render() {
  if (!app.data) return;
  const media = currentMedia();
  document.title = `${app.data.project.title} · Studio`;
  $('#project-title').textContent = app.data.project.title;
  $('#view-review').dataset.kind = media?.kind ?? 'none';

  if (media) {
    const seen = seenRevs.get(media.id);
    if (seen && media.rev > seen) toast(`Nouvelle version chargée : v${media.rev}`, 'ok');
    seenRevs.set(media.id, media.rev);
  }
  if (media && !canDraw(media) && app.tool !== 'select') setTool('select');

  stage.load(media);
  timeline.setMedia(media);
  const comments = mediaComments();
  app.numbers = numbering(comments);
  if (!panel.editing) {
    const delivered = new Set(app.data.batches.filter((b) => b.delivered).map((b) => b.n));
    panel.render({ media, comments, numbers: app.numbers, selectedId: app.selectedId, listening: app.data.listening, delivered });
  }
  timeline.setComments(comments, app.selectedId, app.numbers);
  renderMediaList();
  renderHeader();
  renderToolbar();
  renderTransport();
  refreshVisible(true);
  if (app.tab === 'taste') tasteView.render(app.data.taste);
}

function renderHeader() {
  const offline = document.body.dataset.offline === 'true';
  const listening = !offline && app.data?.listening;
  const unsent = app.data?.comments.filter((c) => c.status === 'open' && c.batch == null).length ?? 0;
  const pill = $('#listening');
  pill.dataset.state = offline ? 'offline' : listening ? 'on' : 'off';
  pill.textContent = offline ? 'Studio arrêté' : listening ? 'Claude écoute' : 'Claude n’écoute pas';
  pill.title = offline
    ? 'Le serveur local ne répond plus. Relance /studio dans Claude Code.'
    : listening
      ? 'Tes retours lui arrivent dès que tu cliques sur Envoyer.'
      : 'Tes retours sont gardés. Dis à Claude : « lis mes retours du studio ».';
  $('#send-count').textContent = String(unsent);
  $('#send').disabled = offline || unsent === 0;
}

function renderMediaList() {
  $('#media-list').replaceChildren(
    ...app.data.media.map((m) => {
      const open = app.data.comments.filter((c) => c.mediaId === m.id && c.status !== 'validated').length;
      return h('li', { class: 'media-row' },
        h('button', { class: `media-item${m.id === app.mediaId ? ' active' : ''}`, title: m.file || m.url, onclick: () => selectMedia(m.id) },
          icon(m.kind, 15),
          h('span', { class: 'media-name' }, m.label),
          m.rev > 1 ? h('span', { class: 'badge' }, `v${m.rev}`) : null,
          open ? h('span', { class: 'media-count' }, String(open)) : null),
        h('button', {
          class: 'icon-btn media-remove', title: 'Retirer de la revue', 'aria-label': `Retirer ${m.label}`,
          onclick: () => confirm(`Retirer « ${m.label} » et ses commentaires de la revue ? Le fichier n’est pas touché.`) &&
            api.removeMedia(m.id).then(refresh),
        }, icon('x', 13)));
    }),
  );
}

function renderToolbar() {
  const media = currentMedia();
  const bar = $('#toolbar');
  bar.hidden = !media;
  const draw = canDraw(media);
  bar.replaceChildren(
    ...(draw ? TOOLS : []).map((t) =>
      h('button', { class: 'tool', 'aria-pressed': String(app.tool === t.id), title: `${t.label} (${t.key})`, 'aria-label': t.label, onclick: () => setTool(t.id) }, icon(t.icon, 18))),
    ...(draw ? [h('div', { class: 'tool-sep' })] : []),
    h('button', {
      class: 'tool tool-comment', 'aria-label': 'Commenter',
      title: hasTime(media) ? 'Commenter cet instant ou la plage (C)' : 'Commentaire général (C)',
      onclick: () => startDraft(null),
    }, icon('comment', 18)),
  );
}

// ------------------------------------------------------------------ transport (lecture)
const transport = {
  play: h('button', { class: 'icon-btn big', 'aria-label': 'Lecture', title: 'Lecture / pause (Espace)', onclick: () => stage.player.toggle() }, icon('play', 18)),
  prev: h('button', { class: 'icon-btn', 'aria-label': 'Image précédente', title: 'Image précédente (←)', onclick: () => stage.player.step(-1) }, icon('prev', 16)),
  next: h('button', { class: 'icon-btn', 'aria-label': 'Image suivante', title: 'Image suivante (→)', onclick: () => stage.player.step(1) }, icon('next', 16)),
  time: h('span', { class: 'tc' }, '00:00:00'),
  total: h('span', { class: 'tc tc-total' }, '/ 00:00:00'),
  frame: h('span', { class: 'tc-frame' }, ''),
  range: h('span', { class: 'range-chip', hidden: true }),
  mute: h('button', { class: 'icon-btn', 'aria-label': 'Couper le son', title: 'Son (M)', onclick: toggleMute }, icon('volume', 16)),
  comment: h('button', { class: 'btn btn-small', onclick: () => startDraft(null) }, icon('comment', 13), 'Commenter ', h('kbd', {}, 'C')),
};
$('#transport').append(
  h('div', { class: 'tp-left' }, transport.prev, transport.play, transport.next, h('div', { class: 'tp-clock' }, transport.time, transport.total), transport.frame, transport.range),
  h('div', { class: 'tp-right' }, transport.comment, transport.mute),
);

let lastClock = '';
let lastPaused = null;
function renderClock() {
  const media = currentMedia();
  if (!hasTime(media)) return;
  const p = stage.player;
  const fps = media.fps || 30;
  const text = `${timecode(p.time, fps)}|${timecode(p.duration, fps)}`;
  if (text !== lastClock) {
    lastClock = text;
    transport.time.textContent = timecode(p.time, fps);
    transport.total.textContent = `/ ${timecode(p.duration, fps)}`;
    transport.frame.textContent = media.fps ? `image ${frameOf(p.time, fps)}` : '';
  }
  if (p.paused !== lastPaused) {
    lastPaused = p.paused;
    transport.play.replaceChildren(icon(p.paused ? 'play' : 'pause', 18));
    transport.play.setAttribute('aria-label', p.paused ? 'Lecture' : 'Pause');
  }
}

function renderTransport() {
  const media = currentMedia();
  const range = timeline.range;
  transport.range.hidden = !range;
  if (range && media) {
    transport.range.replaceChildren(
      `IN ${timecode(range.start, media.fps)} → OUT ${timecode(range.end, media.fps)}`,
      h('button', { class: 'chip-x', 'aria-label': 'Effacer la plage', title: 'Effacer la plage (X)', onclick: () => timeline.clearRange() }, icon('x', 11)),
    );
  }
  lastClock = '';
}

function toggleMute() {
  const muted = stage.player.toggleMute();
  transport.mute.replaceChildren(icon(muted ? 'mute' : 'volume', 16));
}

// ------------------------------------------------------------------ annotations visibles
let visibleKey = '';
function refreshVisible(force = false) {
  const media = currentMedia();
  if (!media) return;
  const comments = mediaComments().filter((c) => c.status !== 'validated' || c.id === app.selectedId);
  let list = comments;
  if (hasTime(media)) {
    const t = stage.player.time;
    const paused = stage.player.paused;
    const near = Math.max(0.25, 1 / (media.fps || 30));
    list = comments.filter((c) =>
      c.id === app.selectedId ||
      (paused && c.time != null && (c.end != null ? t >= c.time - 0.02 && t <= c.end + 0.02 : Math.abs(t - c.time) <= near)));
  }
  const key = `${list.map((c) => c.id + c.status + c.kind).join()}|${app.selectedId}|${JSON.stringify(app.draft?.shape ?? null)}|${app.draft?.kind}`;
  if (!force && key === visibleKey) return;
  visibleKey = key;
  stage.setAnnotations({ list, selectedId: app.selectedId, numbers: app.numbers, draft: app.draft });
}

function loop() {
  if (app.tab === 'review') {
    timeline.tick();
    renderClock();
    refreshVisible();
  }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ actions
function selectMedia(id) {
  if (id === app.mediaId) return;
  cancelDraft();
  app.mediaId = id;
  app.selectedId = null;
  history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  render();
}

function setTool(id) {
  if (id !== 'select' && !canDraw(currentMedia())) return;
  app.tool = id;
  stage.setTool(id);
  renderToolbar();
}

function select(id) {
  const c = app.data?.comments.find((x) => x.id === id);
  if (!c) return;
  if (c.mediaId !== app.mediaId) selectMedia(c.mediaId);
  app.selectedId = id;
  if (c.time != null) {
    stage.player.pause();
    stage.player.seek(c.time);
  }
  render();
}

function startDraft(shape) {
  const media = currentMedia();
  if (!media) return;
  if (app.draft && panel.composing) {
    app.draft.shape = shape ?? app.draft.shape;
    refreshVisible(true);
    return;
  }
  stage.player.pause();
  const timed = hasTime(media);
  const range = timed ? timeline.range : null;
  app.selectedId = null;
  app.draft = {
    shape,
    kind: undefined,
    time: timed ? (range ? range.start : stage.player.time) : null,
    end: range ? range.end : null,
    viewport: stage.viewport(),
  };
  panel.openComposer(app.draft, media);
  render();
}

function cancelDraft() {
  if (!app.draft) return;
  app.draft = null;
  panel.closeComposer();
  refreshVisible(true);
}

async function saveDraft({ text, kind, tags }) {
  const media = currentMedia();
  const draft = app.draft;
  if (!draft || !media) return;
  if (!text && !draft.shape) return toast('Écris ton retour, ou dessine sur l’image.', 'warn');
  try {
    // capture d'abord : l'image affichée est exactement celle que tu commentes
    const wantsSnap = media.kind === 'video' || (media.kind === 'image' && draft.shape);
    if (media.kind === 'video') {
      stage.player.pause();
      await stage.player.seekExact(draft.time);
    }
    const snap = wantsSnap ? await stage.snapshot(draft.shape, kind) : null;
    const c = await api.createComment({ mediaId: media.id, kind, text, tags, time: draft.time, end: draft.end, shape: draft.shape, viewport: draft.viewport });
    if (snap) await api.uploadSnap(c.id, snap);
    app.draft = null;
    app.selectedId = c.id;
    panel.closeComposer();
    timeline.clearRange();
    await refresh();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function send() {
  if (panel.composing) return toast('Termine ou annule le commentaire en cours avant d’envoyer.', 'warn');
  try {
    const { listening } = await api.submit();
    toast(listening ? 'Envoyé. Claude s’y met.' : 'Envoyé et gardé. Claude n’écoute pas : dis-lui « lis mes retours du studio ».', listening ? 'ok' : 'warn');
    await refresh();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function stepComment(direction) {
  const list = [...app.numbers.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  if (!list.length) return;
  const index = list.indexOf(app.selectedId);
  const next = index === -1 ? (direction > 0 ? 0 : list.length - 1) : (index + direction + list.length) % list.length;
  select(list[next]);
}

// ------------------------------------------------------------------ événements
$('#send').addEventListener('click', send);

for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => {
    app.tab = tab.dataset.tab;
    for (const t of document.querySelectorAll('[data-tab]')) t.setAttribute('aria-selected', String(t === tab));
    $('#view-review').hidden = app.tab !== 'review';
    $('#view-taste').hidden = app.tab !== 'taste';
    if (app.tab === 'taste') {
      stage.player.pause();
      tasteView.render(app.data?.taste);
    } else stage.layout();
  });
}

$('#media-add').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#media-add-input');
  const value = input.value.trim().replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ');
  if (!value) return;
  const isUrl = /^https?:\/\//.test(value);
  try {
    const { added } = await api.addMedia(isUrl ? [] : [value], isUrl ? [value] : []);
    input.value = '';
    if (added.length) {
      app.mediaId = added[0].id;
      history.replaceState(null, '', `#${encodeURIComponent(app.mediaId)}`);
    }
    await refresh();
  } catch (e) {
    toast(e.message, 'error');
  }
});

document.addEventListener('keydown', (event) => {
  if (app.tab !== 'review') return;
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !panel.composing) {
    event.preventDefault();
    return send();
  }
  if (isTyping(event) || event.metaKey || event.ctrlKey || event.altKey) return;
  const media = currentMedia();
  if (!media) return;
  const timed = hasTime(media);
  const p = stage.player;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const tool = TOOLS.find((t) => t.key.toLowerCase() === key);

  if (key === ' ' && timed) p.toggle();
  else if (key === 'ArrowLeft' && timed) event.shiftKey ? p.seek(p.time - 1) : p.step(-1);
  else if (key === 'ArrowRight' && timed) event.shiftKey ? p.seek(p.time + 1) : p.step(1);
  else if (key === 'ArrowUp') stepComment(-1);
  else if (key === 'ArrowDown') stepComment(1);
  else if (key === 'Home' && timed) p.seek(0);
  else if (key === 'End' && timed) p.seek(p.duration);
  else if (key === 'c') startDraft(null);
  else if (key === 'i' && timed) timeline.markIn(p.time);
  else if (key === 'o' && timed) timeline.markOut(p.time);
  else if (key === 'x' && timed) timeline.clearRange();
  else if (key === 'm' && timed) toggleMute();
  else if (tool) setTool(tool.id);
  else if (key === 'Escape') {
    if (app.draft) cancelDraft();
    else if (app.tool !== 'select') setTool('select');
    else if (app.selectedId) {
      app.selectedId = null;
      render();
    }
    return;
  } else return;
  event.preventDefault();
});

window.addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id && app.data?.media.some((m) => m.id === id)) selectMedia(id);
});

listen((type) => {
  if (type === 'offline') {
    document.body.dataset.offline = 'true';
    renderHeader();
  } else refreshSoon();
});

await refresh();
requestAnimationFrame(loop);
