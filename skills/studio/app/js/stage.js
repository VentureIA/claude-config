// La scène : affiche le média (vidéo, image, audio, page web), superpose le calque d'annotations,
// gère les outils de dessin et produit la capture annotée envoyée à Claude.

import { clamp, clock, frameOf, h, hasTime, icon, svg } from './util.js';

export const KIND_COLORS = { fix: '#ff6b3d', like: '#3dd68c', idea: '#8f9bff' };
const PAD = 28;
const PAD_LEFT = 76; // la barre d'outils flotte à gauche

export function createStage(root, { onDraft, onSelect, onReady }) {
  const layer = h('div', { class: 'stage-media' });
  const overlay = svg('svg', { class: 'stage-overlay', 'aria-hidden': 'true' });
  root.append(layer, overlay);

  let media = null;
  let el = null;
  let tool = 'select';
  let muted = false;
  let drawing = null;
  let box = { x: 0, y: 0, w: 0, h: 0 };
  let annotations = { list: [], selectedId: null, numbers: new Map(), draft: null };

  // ------------------------------------------------------------------ mise en page
  function naturalSize() {
    if (!el || !media) return null;
    if (media.kind === 'video') return { w: el.videoWidth || media.width, h: el.videoHeight || media.height };
    if (media.kind === 'image') return { w: el.naturalWidth || media.width || 1200, h: el.naturalHeight || media.height || 800 };
    return null;
  }

  function layout() {
    if (!el || !media || media.kind === 'audio') return;
    const r = root.getBoundingClientRect();
    const avail = { x: PAD_LEFT, y: PAD, w: Math.max(10, r.width - PAD_LEFT - PAD), h: Math.max(10, r.height - PAD * 2) };
    let w = avail.w;
    let hh = avail.h;
    if (media.kind !== 'web') {
      const n = naturalSize();
      if (!n?.w || !n?.h) return;
      const scale = Math.min(avail.w / n.w, avail.h / n.h);
      w = n.w * scale;
      hh = n.h * scale;
    }
    box = { x: avail.x + (avail.w - w) / 2, y: avail.y + (avail.h - hh) / 2, w, h: hh };
    const place = { left: `${box.x}px`, top: `${box.y}px`, width: `${w}px`, height: `${hh}px` };
    Object.assign(el.style, place);
    Object.assign(overlay.style, place);
    overlay.setAttribute('viewBox', `0 0 ${w} ${hh}`);
    draw();
  }
  new ResizeObserver(layout).observe(root);

  // ------------------------------------------------------------------ chargement
  function load(next) {
    if (media && next && media.id === next.id && media.rev === next.rev) {
      media = next;
      return;
    }
    const keepTime = media && next && media.id === next.id && el && hasTime(media) ? el.currentTime : 0;
    media = next;
    drawing = null;
    layer.replaceChildren();
    el = null;
    root.dataset.kind = media?.kind ?? 'none';
    if (!media) return;

    const src = media.kind === 'web' ? media.url : `/media/${encodeURIComponent(media.id)}?v=${media.rev}`;
    const ready = () => {
      if (keepTime && hasTime(media)) el.currentTime = Math.min(keepTime, el.duration || keepTime);
      layout();
      onReady?.();
    };
    if (media.kind === 'video') {
      el = h('video', { src, preload: 'auto', playsinline: true, class: 'media-el' });
      el.muted = muted;
      el.addEventListener('loadedmetadata', ready, { once: true });
      el.addEventListener('click', () => tool === 'select' && player.toggle());
    } else if (media.kind === 'image') {
      el = h('img', { src, alt: media.label, class: 'media-el', draggable: 'false' });
      el.addEventListener('load', ready, { once: true });
    } else if (media.kind === 'audio') {
      el = h('audio', { src, preload: 'auto' });
      el.muted = muted;
      el.addEventListener('loadedmetadata', ready, { once: true });
      layer.append(
        h('div', { class: 'audio-card' },
          icon('audio', 30),
          h('div', { class: 'audio-title' }, media.label),
          h('div', { class: 'audio-meta' }, media.duration ? clock(media.duration) : 'Audio'),
          h('div', { class: 'audio-hint' }, 'Commente sur la timeline : touche C, ou sélectionne une plage avec I et O.')),
      );
    } else {
      el = h('iframe', { src, class: 'media-el', title: media.label });
      el.addEventListener('load', () => onReady?.());
      requestAnimationFrame(layout);
    }
    layer.append(el);
    if (media.kind === 'web') {
      layer.append(h('a', { class: 'web-open', href: media.url, target: '_blank', rel: 'noreferrer' }, 'Page blanche ? Ouvrir dans un onglet ↗'));
    }
  }

  // ------------------------------------------------------------------ outils
  function setTool(next) {
    tool = next;
    root.dataset.tool = next;
    drawing = null;
    draw();
  }

  function pointFrom(event) {
    const r = overlay.getBoundingClientRect();
    return { x: clamp((event.clientX - r.left) / r.width, 0, 1), y: clamp((event.clientY - r.top) / r.height, 0, 1) };
  }

  function shapeFrom(d) {
    const { start: a, end: b = d.start } = d;
    if (d.type === 'rect') return { type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    if (d.type === 'arrow') return { type: 'arrow', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    return { type: 'path', points: d.points };
  }

  const tooSmall = (s) =>
    (s.type === 'rect' && s.w < 0.008 && s.h < 0.008) ||
    (s.type === 'arrow' && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 0.01) ||
    (s.type === 'path' && s.points.length < 3);

  overlay.addEventListener('pointerdown', (event) => {
    if (tool === 'select' || !media || media.kind === 'audio' || event.button !== 0) return;
    event.preventDefault();
    const p = pointFrom(event);
    if (tool === 'pin') return onDraft({ type: 'pin', x: p.x, y: p.y });
    overlay.setPointerCapture(event.pointerId);
    drawing = { type: tool, start: p, end: p, points: [[p.x, p.y]] };
    draw();
  });

  overlay.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const p = pointFrom(event);
    drawing.end = p;
    const last = drawing.points.at(-1);
    if (drawing.type === 'path' && Math.hypot(p.x - last[0], p.y - last[1]) > 0.003) drawing.points.push([p.x, p.y]);
    draw();
  });

  const finish = () => {
    if (!drawing) return;
    const shape = shapeFrom(drawing);
    const start = drawing.start;
    drawing = null;
    onDraft(tooSmall(shape) ? { type: 'pin', x: start.x, y: start.y } : shape);
  };
  overlay.addEventListener('pointerup', finish);
  overlay.addEventListener('pointercancel', () => {
    drawing = null;
    draw();
  });

  // ------------------------------------------------------------------ annotations
  function setAnnotations(next) {
    annotations = next;
    draw();
  }

  function draw() {
    overlay.replaceChildren();
    if (!box.w || media?.kind === 'audio') return;
    const items = annotations.list
      .filter((c) => c.shape)
      .map((c) => ({ shape: c.shape, kind: c.kind, id: c.id, n: annotations.numbers.get(c.id), selected: c.id === annotations.selectedId, dim: c.status !== 'open' }));
    if (annotations.draft?.shape) items.push({ shape: annotations.draft.shape, kind: annotations.draft.kind, draft: true });
    if (drawing) items.push({ shape: shapeFrom(drawing), kind: annotations.draft?.kind ?? 'fix', draft: true });
    for (const item of items) overlay.append(renderShape(item));
  }

  function renderShape({ shape, kind, id, n, selected, dim, draft }) {
    const W = box.w;
    const H = box.h;
    const color = KIND_COLORS[kind] ?? KIND_COLORS.fix;
    const g = svg('g', { class: `ann${selected ? ' selected' : ''}${dim ? ' dim' : ''}${draft ? ' draft' : ''}` });
    if (id) {
      g.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        onSelect(id);
      });
    }
    const stroke = { stroke: color, 'stroke-width': selected || draft ? 3 : 2.25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' };
    let anchor = [0, 0];
    if (shape.type === 'rect') {
      const r = { x: shape.x * W, y: shape.y * H, width: shape.w * W, height: shape.h * H, rx: 4 };
      g.append(svg('rect', { ...r, ...stroke, fill: color, 'fill-opacity': selected ? 0.16 : 0.08 }));
      anchor = [r.x, r.y];
    } else if (shape.type === 'arrow') {
      const [x1, y1, x2, y2] = [shape.x1 * W, shape.y1 * H, shape.x2 * W, shape.y2 * H];
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const size = 13;
      const head = [-0.45, 0.45].map((d) => `${x2 - size * Math.cos(angle + d)},${y2 - size * Math.sin(angle + d)}`);
      g.append(
        svg('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': 16 }),
        svg('line', { x1, y1, x2, y2, ...stroke }),
        svg('polygon', { points: `${x2},${y2} ${head.join(' ')}`, fill: color }),
      );
      anchor = [x1, y1];
    } else if (shape.type === 'path') {
      const d = shape.points.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * W).toFixed(1)} ${(y * H).toFixed(1)}`).join('');
      g.append(svg('path', { d, stroke: 'transparent', 'stroke-width': 16, fill: 'none' }), svg('path', { d, ...stroke }));
      anchor = [shape.points[0][0] * W, shape.points[0][1] * H];
    } else {
      anchor = [shape.x * W, shape.y * H];
    }
    const pin = shape.type === 'pin';
    const radius = pin ? 12 : 9;
    const badge = svg('g', { class: 'ann-badge', transform: `translate(${anchor[0]},${anchor[1]})` });
    badge.append(
      svg('circle', { r: radius, fill: color, stroke: '#0b0b0d', 'stroke-width': 2 }),
      Object.assign(svg('text', { 'text-anchor': 'middle', dy: '0.35em', 'font-size': pin ? 12 : 10 }), { textContent: draft ? '+' : String(n ?? '') }),
    );
    g.append(badge);
    return g;
  }

  // ------------------------------------------------------------------ capture pour Claude
  function paint(ctx, shape, color, W, H) {
    const lw = Math.max(3, W / 360);
    Object.assign(ctx, { strokeStyle: color, fillStyle: color, lineWidth: lw, lineCap: 'round', lineJoin: 'round' });
    if (shape.type === 'rect') {
      ctx.globalAlpha = 0.12;
      ctx.fillRect(shape.x * W, shape.y * H, shape.w * W, shape.h * H);
      ctx.globalAlpha = 1;
      ctx.strokeRect(shape.x * W, shape.y * H, shape.w * W, shape.h * H);
    } else if (shape.type === 'arrow') {
      const [x1, y1, x2, y2] = [shape.x1 * W, shape.y1 * H, shape.x2 * W, shape.y2 * H];
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const size = lw * 5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      for (const d of [-0.45, 0.45]) ctx.lineTo(x2 - size * Math.cos(angle + d), y2 - size * Math.sin(angle + d));
      ctx.closePath();
      ctx.fill();
    } else if (shape.type === 'path') {
      ctx.beginPath();
      shape.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(shape.x * W, shape.y * H, lw * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  async function snapshot(shape, kind) {
    if (!el || !media || !['video', 'image'].includes(media.kind)) return null;
    const n = naturalSize();
    if (!n?.w || !n?.h) return null;
    const scale = Math.min(1, 1920 / Math.max(n.w, n.h));
    const W = Math.round(n.w * scale);
    const H = Math.round(n.h * scale);
    const canvas = h('canvas', { width: W, height: H });
    const ctx = canvas.getContext('2d');
    ctx.drawImage(el, 0, 0, W, H);
    if (shape) paint(ctx, shape, KIND_COLORS[kind] ?? KIND_COLORS.fix, W, H);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  // ------------------------------------------------------------------ lecture
  const player = {
    get time() {
      return el && hasTime(media) ? el.currentTime : 0;
    },
    get duration() {
      return el && hasTime(media) ? el.duration || media.duration || 0 : 0;
    },
    get paused() {
      return !el || !hasTime(media) || el.paused;
    },
    get muted() {
      return muted;
    },
    play() {
      if (hasTime(media)) el?.play().catch(() => {});
    },
    pause() {
      if (hasTime(media)) el?.pause();
    },
    toggle() {
      player.paused ? player.play() : player.pause();
    },
    seek(t) {
      if (el && hasTime(media)) el.currentTime = clamp(t, 0, player.duration || 0);
    },
    step(frames) {
      if (!el || !hasTime(media)) return;
      const fps = media.fps || 30;
      player.pause();
      // on vise le milieu de l'image pour que le navigateur affiche bien la bonne
      el.currentTime = clamp((frameOf(el.currentTime, fps) + frames + 0.5) / fps, 0, player.duration);
    },
    // se recale sur un instant précis et attend que l'image soit affichée (pour la capture)
    seekExact(t) {
      if (!el || !hasTime(media) || t == null) return Promise.resolve();
      const fps = media.fps || 30;
      if (frameOf(el.currentTime, fps) === frameOf(t, fps) && !el.seeking) return Promise.resolve();
      return new Promise((resolve) => {
        el.addEventListener('seeked', () => resolve(), { once: true });
        el.currentTime = t;
      });
    },
    toggleMute() {
      muted = !muted;
      if (el && hasTime(media)) el.muted = muted;
      return muted;
    },
  };

  return {
    load,
    layout,
    setTool,
    setAnnotations,
    snapshot,
    player,
    viewport: () => (media?.kind === 'web' ? { w: box.w, h: box.h } : null),
  };
}
