// Briques partagées par le serveur et la CLI du studio : chemins, formats, sondes ffprobe/ffmpeg,
// et le texte des retours tel que Claude le lit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

export const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(SERVER_DIR, '..');
export const APP_DIR = path.join(SKILL_DIR, 'app');
export const CLI = path.join(SERVER_DIR, 'studio.mjs');
// node ou bun : le studio tourne avec l'un comme avec l'autre
export const RUNTIME = path.basename(process.execPath).replace(/\.exe$/, '');
export const GLOBAL_TASTE = path.join(os.homedir(), '.claude', 'studio', 'gouts.md');
export const TASTE_TEMPLATE = path.join(SKILL_DIR, 'templates', 'gouts.md');
export const DEFAULT_PORT = 4747;

export const studioDir = (dir) => path.join(dir, '.studio');
export const reviewFile = (dir) => path.join(studioDir(dir), 'review.json');
export const serverFile = (dir) => path.join(studioDir(dir), 'server.json');
export const projectTaste = (dir) => path.join(studioDir(dir), 'gouts.md');

const EXTENSIONS = {
  video: ['mp4', 'm4v', 'mov', 'webm'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
};

export const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8', md: 'text/markdown; charset=utf-8',
};

export const now = () => new Date().toISOString();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const newId = (prefix) => prefix + crypto.randomBytes(3).toString('hex');
export const stableId = (prefix, seed) => prefix + crypto.createHash('sha1').update(seed).digest('hex').slice(0, 8);
export const expandHome = (p) => p.replace(/^~(?=$|\/)/, os.homedir());

export function mediaKind(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return Object.keys(EXTENSIONS).find((kind) => EXTENSIONS[kind].includes(ext)) ?? null;
}

export function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

export function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function ensureGlobalTaste() {
  if (!fs.existsSync(GLOBAL_TASTE)) writeAtomic(GLOBAL_TASTE, readText(TASTE_TEMPLATE));
}

export async function probe(file) {
  try {
    const { stdout } = await execFileP(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
      { maxBuffer: 1 << 22 },
    );
    const info = JSON.parse(stdout);
    const video = info.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    const audio = info.streams?.find((s) => s.codec_type === 'audio');
    const [num, den] = String(video?.avg_frame_rate || video?.r_frame_rate || '0/0').split('/').map(Number);
    return {
      width: video?.width ?? null,
      height: video?.height ?? null,
      fps: num && den ? Math.round((num / den) * 1000) / 1000 : null,
      duration: Number(info.format?.duration) || null,
      hasAudio: Boolean(audio),
    };
  } catch {
    return {};
  }
}

// Enveloppe du son, normalisée entre 0 et 1, pour dessiner la forme d'onde de la timeline.
export async function computePeaks(file, buckets = 1500) {
  const { stdout } = await execFileP(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '4000', '-f', 's16le', '-'],
    { encoding: 'buffer', maxBuffer: 1 << 28 },
  );
  const count = Math.floor(stdout.length / 2);
  const size = Math.max(1, Math.floor(count / buckets));
  const peaks = [];
  for (let start = 0; start < count; start += size) {
    let max = 0;
    for (let i = start, end = Math.min(start + size, count); i < end; i++) {
      const v = Math.abs(stdout.readInt16LE(i * 2));
      if (v > max) max = v;
    }
    peaks.push(max / 32768);
  }
  const top = peaks.reduce((a, b) => Math.max(a, b), 0.01);
  return peaks.map((p) => Math.round((p / top) * 1000) / 1000);
}

// Pellicule de la timeline : `count` vignettes de `height` px, côte à côte dans un seul PNG.
export async function filmstrip(file, duration, count, height) {
  const { stdout } = await execFileP(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-an', '-vf', `fps=${count}/${duration},scale=-2:${height},tile=${count}x1`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
    { encoding: 'buffer', maxBuffer: 1 << 27 },
  );
  return stdout;
}

// ---------------------------------------------------------------------------------------------
// Texte des retours pour Claude
// ---------------------------------------------------------------------------------------------

export const frameOf = (seconds, fps) => Math.floor(seconds * fps + 1e-6);

// mm:ss:ii (minutes, secondes, image dans la seconde)
export function timecode(seconds, fps) {
  const rate = Math.round(fps || 30);
  const frames = frameOf(seconds, rate);
  const whole = Math.floor(frames / rate);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}:${pad(frames % rate)}`;
}

const KIND_LABEL = { fix: 'À CORRIGER', like: "J'AIME", idea: 'IDÉE' };
const MEDIA_LABEL = { video: 'vidéo', image: 'image', audio: 'audio', web: 'page web' };

function describeMedia(m) {
  if (m.kind === 'web') return `page web · ${m.url}`;
  const parts = [MEDIA_LABEL[m.kind]];
  if (m.width) parts.push(`${m.width}×${m.height}`);
  if (m.fps && m.kind === 'video') parts.push(`${m.fps} i/s`);
  if (m.duration && m.kind !== 'image') parts.push(`${m.duration.toFixed(2)} s`);
  parts.push(`v${m.rev}`, m.file);
  return parts.join(' · ');
}

function bbox(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function describeShape(shape, width, height) {
  const pct = (v) => `${Math.round(v * 100)} %`;
  const px = (x, y) => (width && height ? ` = (${Math.round(x * width)}, ${Math.round(y * height)}) px` : '');
  switch (shape.type) {
    case 'pin':
      return `point à x ${pct(shape.x)}, y ${pct(shape.y)}${px(shape.x, shape.y)}`;
    case 'rect': {
      const size = width && height ? `, ${Math.round(shape.w * width)}×${Math.round(shape.h * height)} px` : '';
      return `zone depuis x ${pct(shape.x)}, y ${pct(shape.y)}${px(shape.x, shape.y)}, taille ${pct(shape.w)} × ${pct(shape.h)}${size}`;
    }
    case 'arrow':
      return `flèche de (${pct(shape.x1)}, ${pct(shape.y1)}) vers (${pct(shape.x2)}, ${pct(shape.y2)})${px(shape.x2, shape.y2)}`;
    case 'path': {
      const b = bbox(shape.points);
      return `tracé autour de x ${pct(b.x)}–${pct(b.x + b.w)}, y ${pct(b.y)}–${pct(b.y + b.h)}`;
    }
    default:
      return '';
  }
}

function commentLines(c, m, dir) {
  const where = [];
  if (c.time != null) {
    const fps = m.fps || 30;
    if (c.end != null) {
      where.push(`${timecode(c.time, fps)} → ${timecode(c.end, fps)}`);
      if (m.fps) where.push(`images ${frameOf(c.time, fps)} à ${frameOf(c.end, fps)}`);
    } else {
      where.push(timecode(c.time, fps));
      if (m.fps) where.push(`image ${frameOf(c.time, fps)}`);
    }
  }
  const width = c.viewport?.w ?? m.width;
  const height = c.viewport?.h ?? m.height;
  if (c.shape) where.push(describeShape(c.shape, width, height));
  if (c.viewport) where.push(`fenêtre ${c.viewport.w}×${c.viewport.h}`);
  if (c.tags?.length) where.push(c.tags.map((t) => `#${t}`).join(' '));
  if (c.mediaRev !== m.rev) where.push(`posé sur la v${c.mediaRev}`);

  const lines = [`- **[${c.id}] ${KIND_LABEL[c.kind] ?? c.kind}**${where.length ? ` · ${where.join(' · ')}` : ''}`];
  lines.push(`  « ${c.text?.trim() || '(sans texte : regarde la capture)'} »`);
  if (c.reopened) lines.push(`  ↺ Rouvert. Ta réponse précédente : « ${c.reopened} »`);
  if (c.snap) lines.push(`  Capture annotée : ${path.join(studioDir(dir), c.snap)}`);
  return lines;
}

export function feedbackMarkdown(state, comments, title) {
  const dir = state.project.dir;
  const lines = [`# ${title} · ${comments.length} commentaire${comments.length > 1 ? 's' : ''}`, '', `Projet : ${dir}`, ''];
  for (const m of state.media) {
    const list = comments
      .filter((c) => c.mediaId === m.id)
      .sort((a, b) => (a.time ?? -1) - (b.time ?? -1));
    if (!list.length) continue;
    lines.push(`## ${m.label} · ${describeMedia(m)}`, '');
    for (const c of list) lines.push(...commentLines(c, m, dir));
    lines.push('');
  }
  lines.push(
    '---',
    `Répondre à chaque commentaire : ${RUNTIME} ${CLI} reply <id> done|wontfix "ce que tu as fait" --dir "${dir}"`,
    `Puis relancer l'écoute en arrière-plan : ${RUNTIME} ${CLI} wait --dir "${dir}"`,
  );
  return lines.join('\n');
}
