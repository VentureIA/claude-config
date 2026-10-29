// L'onglet « Goûts » : le fichier que Claude enrichit après chaque série de retours.
// On y voit ce qu'il a appris récemment, on supprime ce qui est faux, on modifie librement.

import { h, icon } from './util.js';

const RECENT_DAYS = 14;
const SCOPES = {
  global: { label: 'Mes goûts', hint: 'Tous projets : ton œil, ton rythme, tes réflexes.' },
  project: { label: 'Ce projet', hint: 'La charte et les contraintes de ce client ou de cette marque.' },
};

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// « - Règle. _(Projet · c_123 · 2026-10-22)_ » : la parenthèse finale est la provenance, affichée en discret.
const META = /\s+[_*]\(([^)]*)\)[_*]\s*$/;
const splitMeta = (s) => {
  const m = META.exec(s);
  return m ? { body: s.slice(0, m.index), meta: m[1] } : { body: s, meta: null };
};
const inline = (raw) => {
  const { body, meta } = splitMeta(raw);
  return inlineBody(body) + (meta ? ` <span class="meta">${escapeHtml(meta)}</span>` : '');
};
const inlineBody = (s) =>
  escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');

function markdown(text) {
  const out = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) out.push('</ul>');
    listOpen = false;
  };
  for (const line of text.split('\n')) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      out.push(`<h${heading[1].length + 1}>${inline(heading[2])}</h${heading[1].length + 1}>`);
    } else if (item) {
      if (!listOpen) out.push('<ul>');
      listOpen = true;
      out.push(`<li>${inline(item[1])}</li>`);
    } else if (line.startsWith('>')) {
      closeList();
      const text = inline(line.replace(/^>\s?/, ''));
      if (out.at(-1)?.endsWith('</blockquote>')) out.push(out.pop().replace('</blockquote>', `<br>${text}</blockquote>`));
      else out.push(`<blockquote>${text}</blockquote>`);
    } else if (line.trim()) {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    } else {
      closeList();
    }
  }
  closeList();
  return out.join('');
}

function recentEntries(text, scope) {
  const limit = Date.now() - RECENT_DAYS * 86400000;
  const entries = [];
  let section = '';
  text.split('\n').forEach((line, index) => {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) section = heading[1];
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    const dates = item ? line.match(/\d{4}-\d{2}-\d{2}/g) : null;
    if (!dates) return;
    const date = dates.at(-1);
    if (Date.parse(date) < limit) return;
    entries.push({ scope, index, line, date, section, text: item[1] });
  });
  return entries;
}

export function createTasteView(root, { onSave }) {
  let scope = 'global';
  let editing = false;
  let taste = null;

  async function removeLine(entry) {
    const lines = taste[entry.scope].text.split('\n');
    if (lines[entry.index] !== entry.line) return;
    lines.splice(entry.index, 1);
    await onSave(entry.scope, lines.join('\n'));
  }

  function render(next) {
    if (next) taste = next;
    if (!taste || editing) return;
    const file = taste[scope];
    const recent = [...recentEntries(taste.global.text, 'global'), ...recentEntries(taste.project.text, 'project')]
      .sort((a, b) => b.date.localeCompare(a.date));

    const tabs = h('div', { class: 'seg seg-scope', role: 'tablist' },
      Object.entries(SCOPES).map(([id, s]) =>
        h('button', { class: 'seg-btn', role: 'tab', 'aria-selected': String(id === scope), onclick: () => ((scope = id), render()) }, s.label)));

    const doc = file.text.trim()
      ? h('article', { class: 'taste-doc', html: markdown(file.text) })
      : h('div', { class: 'empty' },
          h('p', {}, scope === 'project' ? 'Pas encore de goûts propres à ce projet.' : 'Le fichier est vide.'),
          h('p', { class: 'muted' }, scope === 'project'
            ? 'Claude en ajoutera quand un retour concerne la marque : charte, logo, ton, contraintes du client.'
            : 'Claude le remplira au fil de tes retours.'));

    root.replaceChildren(
      h('div', { class: 'taste-wrap' },
        h('header', { class: 'taste-head' },
          h('div', {},
            h('h1', {}, 'Tes goûts'),
            h('p', { class: 'muted' }, 'Claude relit ces fichiers avant chaque montage, motion ou visuel, et les complète après chaque série de retours.')),
          tabs),
        h('div', { class: 'taste-grid' },
          h('aside', { class: 'taste-recent' },
            h('h2', {}, `Appris ces ${RECENT_DAYS} derniers jours`),
            recent.length
              ? recent.map((e) =>
                  h('div', { class: 'learned' },
                    h('div', { class: 'learned-meta' }, h('span', {}, SCOPES[e.scope].label), e.section ? h('span', {}, e.section) : null, h('span', {}, e.date)),
                    h('p', { html: inlineBody(splitMeta(e.text).body) }),
                    splitMeta(e.text).meta ? h('div', { class: 'learned-source' }, splitMeta(e.text).meta.replace(/\s*·?\s*\d{4}-\d{2}-\d{2}\s*$/, '')) : null,
                    h('button', { class: 'icon-btn', title: 'Faux : supprimer', 'aria-label': 'Supprimer cet apprentissage', onclick: () => removeLine(e) }, icon('x', 14))))
              : h('p', { class: 'muted' }, 'Rien de nouveau. Envoie des retours (et des « J’aime ») depuis la revue.')),
          h('section', { class: 'taste-main' },
            h('div', { class: 'taste-toolbar' },
              h('span', { class: 'muted path' }, SCOPES[scope].hint, ' · ', h('code', {}, file.path.replace(/^\/Users\/[^/]+/, '~'))),
              h('button', { class: 'btn btn-ghost', onclick: startEdit }, icon('edit', 14), 'Modifier')),
            doc))),
    );
  }

  function startEdit() {
    editing = true;
    const file = taste[scope];
    const area = h('textarea', { class: 'taste-editor', spellcheck: 'true' });
    area.value = file.text || `# ${SCOPES[scope].label}\n\n`;
    const stop = () => {
      editing = false;
      render();
    };
    const save = async () => {
      await onSave(scope, area.value);
      taste[scope].text = area.value;
      stop();
    };
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
      if (e.key === 'Escape') stop();
    });
    root.querySelector('.taste-main').replaceChildren(
      h('div', { class: 'taste-toolbar' },
        h('span', { class: 'muted' }, '⌘↵ enregistrer · Échap annuler'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-ghost', onclick: stop }, 'Annuler'),
          h('button', { class: 'btn btn-primary', onclick: save }, 'Enregistrer'))),
      area,
    );
    area.focus();
  }

  return { render };
}
