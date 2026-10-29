// La timeline : règle, pellicule, forme d'onde, repères des commentaires, plage IN/OUT et tête de lecture.
// Cliquer-glisser déplace la tête ; Maj + glisser sélectionne une plage.

import { api } from './api.js';
import { KIND_COLORS } from './stage.js';
import { clamp, clock, h, hasTime } from './util.js';

const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

const once = (el, type) =>
  new Promise((resolve, reject) => {
    el.addEventListener(type, resolve, { once: true });
    el.addEventListener('error', reject, { once: true });
  });

function prepareCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const hh = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hh * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hh);
  return { ctx, w, h: hh };
}

export function createTimeline(root, { player, onRange, onSelect }) {
  const ruler = h('canvas', { class: 'tl-ruler' });
  const film = h('canvas', { class: 'tl-film' });
  const wave = h('canvas', { class: 'tl-wave' });
  const marks = h('div', { class: 'tl-marks' });
  const band = h('div', { class: 'tl-range', hidden: true });
  const head = h('div', { class: 'tl-head' }, h('div', { class: 'tl-head-knob' }));
  const track = h('div', { class: 'tl-track' }, ruler, film, wave, marks, band, head);
  root.append(track);

  let media = null;
  let peaks = null;
  let filmToken = 0;
  let filmTimer = null;
  let range = null;
  let dragging = null;

  const duration = () => player.duration || media?.duration || 0;
  const pct = (t) => `${(clamp(t / (duration() || 1), 0, 1) * 100).toFixed(3)}%`;
  const timeAt = (event) => {
    const r = track.getBoundingClientRect();
    return clamp((event.clientX - r.left) / r.width, 0, 1) * duration();
  };

  // ------------------------------------------------------------------ dessins
  function drawRuler() {
    const { ctx, w, h: hh } = prepareCanvas(ruler);
    const d = duration();
    if (!d || !w) return;
    const perSecond = w / d;
    const step = RULER_STEPS.find((s) => s * perSecond >= 72) ?? 600;
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textBaseline = 'top';
    for (let i = 0; i * (step / 5) <= d + 1e-6; i++) {
      const t = i * (step / 5);
      const x = Math.round(t * perSecond) + 0.5;
      const major = i % 5 === 0;
      ctx.fillStyle = major ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.14)';
      ctx.fillRect(x, hh - (major ? 7 : 4), 1, major ? 7 : 4);
      if (major && x < w - 24) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(step < 1 ? `${t.toFixed(1)} s` : clock(t), x + 4, 3);
      }
    }
  }

  function drawWave() {
    const { ctx, w, h: hh } = prepareCanvas(wave);
    if (!peaks?.length || !w) return;
    const bar = 2;
    const gap = 1;
    const count = Math.floor(w / (bar + gap));
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i < count; i++) {
      const from = Math.floor((i / count) * peaks.length);
      const to = Math.max(from + 1, Math.floor(((i + 1) / count) * peaks.length));
      let p = 0;
      for (let j = from; j < to; j++) p = Math.max(p, peaks[j] ?? 0);
      const barH = Math.max(1, p * (hh - 6));
      ctx.fillRect(i * (bar + gap), (hh - barH) / 2, bar, barH);
    }
  }

  async function drawFilm() {
    const token = ++filmToken;
    const { ctx, w, h: hh } = prepareCanvas(film);
    const d = duration();
    if (media?.kind !== 'video' || !w || !hh || !d) return;
    const tileW = Math.max(18, hh * ((media.width || 16) / (media.height || 9)));
    const count = Math.ceil(w / tileW);
    const paint = (source, i, sx = 0, sw = null) => {
      if (sw) ctx.drawImage(source, sx, 0, sw, source.height, i * tileW, 0, tileW, hh);
      else ctx.drawImage(source, i * tileW, 0, tileW, hh);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(i * tileW + tileW - 1, 0, 1, hh);
    };

    // 1. pellicule calculée par ffmpeg côté serveur (rapide)
    const sprite = new Image();
    sprite.src = `/api/film/${encodeURIComponent(media.id)}?count=${count}&h=${Math.round(hh * (window.devicePixelRatio || 1))}&v=${media.rev}`;
    try {
      await sprite.decode();
      if (token !== filmToken) return;
      const sw = sprite.width / count;
      for (let i = 0; i < count; i++) paint(sprite, i, i * sw, sw);
      return;
    } catch {
      // pas de ffmpeg : on retombe sur la lecture image par image dans le navigateur
    }

    // 2. secours : on parcourt la vidéo dans le navigateur
    const probe = h('video', { preload: 'auto', muted: true, src: `/media/${encodeURIComponent(media.id)}?v=${media.rev}` });
    try {
      await once(probe, 'loadeddata');
      for (let i = 0; i < count && token === filmToken; i++) {
        probe.currentTime = Math.min(d - 0.05, ((i + 0.5) * tileW * d) / w);
        await once(probe, 'seeked');
        if (token !== filmToken) break;
        paint(probe, i);
      }
    } catch {
      // pellicule facultative : la vidéo reste lisible sans elle
    } finally {
      probe.removeAttribute('src');
      probe.load();
    }
  }

  function redraw() {
    drawRuler();
    drawWave();
    clearTimeout(filmTimer);
    filmTimer = setTimeout(drawFilm, 250);
    renderRange();
    tick();
  }
  new ResizeObserver(redraw).observe(track);

  // ------------------------------------------------------------------ média et repères
  async function setMedia(next) {
    const same = media && next && media.id === next.id && media.rev === next.rev;
    media = next;
    if (same) return;
    root.dataset.kind = next?.kind ?? 'none';
    root.dataset.audio = String(Boolean(next?.hasAudio || next?.kind === 'audio'));
    peaks = null;
    range = null;
    redraw();
    if (next && hasTime(next) && root.dataset.audio === 'true') {
      const res = await api.peaks(next.id).catch(() => null);
      if (res && media?.id === next.id && res.rev === media.rev) {
        peaks = res.peaks;
        drawWave();
      }
    }
  }

  function setComments(list, selectedId, numbers) {
    marks.replaceChildren();
    for (const c of list) {
      if (c.time == null) continue;
      const mark = h('button', {
        class: `tl-mark${c.id === selectedId ? ' selected' : ''}${c.status !== 'open' ? ' dim' : ''}${c.end != null ? ' span' : ''}`,
        style: { left: pct(c.time), width: c.end != null ? `calc(${pct(c.end)} - ${pct(c.time)})` : null, '--c': KIND_COLORS[c.kind] },
        title: `${numbers.get(c.id) ?? ''} · ${c.text || '(sans texte)'}`,
        onclick: (event) => {
          event.stopPropagation();
          onSelect(c.id);
        },
      }, h('span', { class: 'tl-mark-n' }, String(numbers.get(c.id) ?? '')));
      mark.addEventListener('pointerdown', (event) => event.stopPropagation());
      marks.append(mark);
    }
  }

  // ------------------------------------------------------------------ plage IN/OUT
  function renderRange() {
    band.hidden = !range;
    if (!range) return;
    band.style.left = pct(range.start);
    band.style.width = `calc(${pct(range.end)} - ${pct(range.start)})`;
  }

  function setRange(next) {
    range = next && next.end - next.start > 0.01 ? { start: next.start, end: next.end } : null;
    renderRange();
    onRange(range);
  }

  function markIn(t) {
    setRange({ start: t, end: range && range.end > t ? range.end : duration() });
  }

  function markOut(t) {
    setRange({ start: range && range.start < t ? range.start : 0, end: t });
  }

  // ------------------------------------------------------------------ interaction
  track.addEventListener('pointerdown', (event) => {
    if (!media || !hasTime(media) || event.button !== 0) return;
    track.setPointerCapture(event.pointerId);
    const t = timeAt(event);
    if (event.shiftKey) {
      dragging = { mode: 'range', from: t };
      range = { start: t, end: t };
      renderRange();
    } else {
      dragging = { mode: 'scrub' };
      player.pause();
      player.seek(t);
    }
  });

  track.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const t = timeAt(event);
    if (dragging.mode === 'scrub') player.seek(t);
    else {
      range = { start: Math.min(dragging.from, t), end: Math.max(dragging.from, t) };
      renderRange();
    }
  });

  const release = () => {
    if (dragging?.mode === 'range') setRange(range);
    dragging = null;
  };
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);

  function tick() {
    head.style.left = pct(player.time);
  }

  return {
    setMedia,
    setComments,
    tick,
    markIn,
    markOut,
    clearRange: () => setRange(null),
    get range() {
      return range;
    },
  };
}
