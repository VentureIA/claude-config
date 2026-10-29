#!/usr/bin/env node
// CLI du studio de revue. Claude s'en sert pour ouvrir le studio, écouter les retours et y répondre.
//
//   start [médias…] [--url http://…] [--dir projet] [--title nom] [--no-open]
//   add   [médias…] [--url http://…]          ajoute des médias sans rouvrir le navigateur
//   wait                                       bloque jusqu'au clic « Envoyer à Claude », puis affiche les retours
//   pending                                    affiche tous les retours encore ouverts
//   reply <id> done|wontfix|open "note"        répond à un commentaire (visible dans le studio)
//   status | stop

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  CLI, DEFAULT_PORT, GLOBAL_TASTE, RUNTIME, expandHome, feedbackMarkdown, projectTaste, readJSON, reviewFile, serverFile,
  sleep, studioDir,
} from './core.mjs';

function parseArgs(argv) {
  const opts = { _: [], url: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key.startsWith('no-')) {
      opts[key.slice(3)] = false;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      opts[key] = true;
      continue;
    }
    i++;
    if (key === 'url') opts.url.push(value);
    else opts[key] = value;
  }
  return opts;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {}
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function findServer(dir) {
  const info = readJSON(serverFile(dir), null);
  if (!info?.port) return null;
  try {
    const { json } = await request(info.port, 'GET', '/api/ping');
    return json?.ok && json.dir === dir ? info.port : null;
  } catch {
    return null;
  }
}

async function requireServer(dir) {
  const port = await findServer(dir);
  if (!port) fail(`Aucun studio ouvert pour ${dir}. Lance d'abord : ${RUNTIME} ${CLI} start --dir "${dir}"`);
  return port;
}

async function spawnServer(dir, opts) {
  fs.mkdirSync(studioDir(dir), { recursive: true });
  const log = fs.openSync(path.join(studioDir(dir), 'server.log'), 'a');
  const args = [CLI, 'serve', '--dir', dir, '--port', String(opts.port || DEFAULT_PORT)];
  if (typeof opts.title === 'string') args.push('--title', opts.title);
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log] });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    const info = readJSON(serverFile(dir), null);
    if (info?.pid === child.pid && (await findServer(dir))) return info.port;
  }
  fail(`Le studio n'a pas démarré. Journal : ${path.join(studioDir(dir), 'server.log')}`);
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

async function addMedia(port, opts) {
  const paths = opts._.map((p) => path.resolve(expandHome(p)));
  if (!paths.length && !opts.url.length) return [];
  const { status, json, text } = await request(port, 'POST', '/api/media', { paths, urls: opts.url });
  if (status !== 200) fail(json?.error || text);
  return json.added;
}

// ------------------------------------------------------------------ commandes

const commands = {
  async serve(opts, dir) {
    const { serve } = await import('./http.mjs');
    await serve({ dir, port: Number(opts.port) || DEFAULT_PORT, title: typeof opts.title === 'string' ? opts.title : undefined });
  },

  async start(opts, dir) {
    const port = (await findServer(dir)) ?? (await spawnServer(dir, opts));
    const added = await addMedia(port, opts);
    const url = `http://localhost:${port}/`;
    if (opts.open !== false) openBrowser(url);
    console.log(`Studio : ${url}`);
    console.log(`Projet : ${dir}`);
    for (const m of added) console.log(`  + ${m.label} (${m.kind}${m.width ? `, ${m.width}×${m.height}` : ''}${m.fps ? `, ${m.fps} i/s` : ''})`);
    console.log(`Goûts : ${GLOBAL_TASTE}${fs.existsSync(projectTaste(dir)) ? ` + ${projectTaste(dir)}` : ''}`);
    console.log(`Écouter les retours (en arrière-plan) : ${RUNTIME} ${CLI} wait --dir "${dir}"`);
  },

  async add(opts, dir) {
    const port = await requireServer(dir);
    for (const m of await addMedia(port, opts)) console.log(`+ ${m.label} (${m.kind}, v${m.rev})`);
  },

  async wait(opts, dir) {
    let misses = 0;
    for (;;) {
      const port = await findServer(dir);
      if (!port) {
        if (++misses > 20) fail('Le studio est fermé. Relance /studio pour reprendre la revue.');
        await sleep(3000);
        continue;
      }
      misses = 0;
      let res;
      try {
        res = await request(port, 'GET', '/api/wait?t=50');
      } catch {
        await sleep(2000);
        continue;
      }
      if (res.status === 200 && res.json?.markdown) {
        console.log(res.json.markdown);
        return;
      }
      if (res.status !== 204) await sleep(2000);
    }
  },

  async pending(opts, dir) {
    const port = await findServer(dir);
    if (port) {
      const { json } = await request(port, 'GET', '/api/pending');
      console.log(json.markdown);
      return;
    }
    const state = readJSON(reviewFile(dir), null);
    if (!state) fail(`Pas de revue dans ${dir}`);
    console.log(feedbackMarkdown(state, state.comments.filter((c) => c.status === 'open'), `Retours ouverts · ${state.project.title}`));
  },

  async reply(opts, dir) {
    const [id, rawStatus, ...rest] = opts._;
    const status = { fait: 'done', done: 'done', non: 'wontfix', wontfix: 'wontfix', open: 'open' }[rawStatus];
    if (!id || !status) fail('Usage : reply <id> done|wontfix|open "ce que tu as fait"');
    const port = await requireServer(dir);
    const { status: code, json } = await request(port, 'PATCH', `/api/comments/${encodeURIComponent(id)}`, {
      status,
      reply: rest.join(' ') || null,
    });
    if (code !== 200) fail(json?.error || `Erreur ${code}`);
    console.log(`✓ ${id} → ${status}`);
  },

  async status(opts, dir) {
    const port = await findServer(dir);
    const state = port ? (await request(port, 'GET', '/api/state')).json : readJSON(reviewFile(dir), null);
    if (!state) return console.log(`Aucun studio pour ${dir}`);
    const open = state.comments.filter((c) => c.status === 'open');
    console.log(port ? `Studio ouvert : http://localhost:${port}/${state.listening ? ' · Claude écoute' : ''}` : 'Studio fermé (revue conservée)');
    console.log(`${state.media.length} média(s) · ${open.length} retour(s) ouvert(s) dont ${open.filter((c) => c.batch == null).length} pas encore envoyé(s)`);
  },

  async stop(opts, dir) {
    const port = await findServer(dir);
    if (!port) return console.log('Le studio est déjà fermé.');
    await request(port, 'POST', '/api/stop').catch(() => {});
    console.log('Studio fermé. La revue reste dans .studio/review.json');
  },

  help() {
    console.log(fs.readFileSync(CLI, 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  },
};

const [name = 'help', ...argv] = process.argv.slice(2);
const opts = parseArgs(argv);
const dir = path.resolve(expandHome(typeof opts.dir === 'string' ? opts.dir : process.cwd()));
const command = commands[name] ?? commands.help;
await command(opts, dir);
