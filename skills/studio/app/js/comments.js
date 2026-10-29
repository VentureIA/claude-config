// Le panneau de droite : rédaction d'un commentaire, puis liste groupée
// (à envoyer, envoyé, traité par Claude, validé) avec les réponses de Claude.

import { KINDS, TAGS, frameOf, h, hasTime, icon, timecode } from './util.js';

const SHAPE_LABEL = { pin: 'Point', rect: 'Zone', arrow: 'Flèche', path: 'Tracé' };

export function where(c, media) {
  const parts = [];
  if (c.time != null && hasTime(media)) {
    parts.push(c.end != null ? `${timecode(c.time, media.fps)} → ${timecode(c.end, media.fps)}` : timecode(c.time, media.fps));
  }
  if (c.shape) parts.push(SHAPE_LABEL[c.shape.type]);
  return parts.join(' · ');
}

export function createPanel(root, handlers) {
  let lastKind = 'fix';
  let showValidated = false;
  let composer = null;
  let editingId = null;
  let snapshot = null;

  const head = h('div', { class: 'panel-head' });
  const composerSlot = h('div', { class: 'composer-slot' });
  const list = h('div', { class: 'panel-list' });
  root.append(head, composerSlot, list);

  // ------------------------------------------------------------------ rédaction
  function openComposer(draft, media) {
    const kind = draft.kind ?? lastKind;
    const tags = new Set();
    const text = h('textarea', { class: 'composer-text', rows: 3, placeholder: placeholderFor(kind), 'aria-label': 'Commentaire' });
    const kinds = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Type de retour' });
    const tagRow = h('div', { class: 'tags' });
    const context = where(draft, media);

    const setKind = (next) => {
      composer.kind = next;
      lastKind = next;
      text.placeholder = placeholderFor(next);
      for (const b of kinds.children) b.setAttribute('aria-checked', String(b.dataset.kind === next));
      handlers.onDraftKind(next);
    };
    for (const [id, k] of Object.entries(KINDS)) {
      kinds.append(h('button', { type: 'button', role: 'radio', class: `seg-btn kind-${id}`, 'data-kind': id, onclick: () => setKind(id) }, h('span', { class: 'dot' }), k.label));
    }
    for (const tag of TAGS) {
      const chip = h('button', { type: 'button', class: 'tag', 'aria-pressed': 'false' }, tag);
      chip.addEventListener('click', () => {
        tags.has(tag) ? tags.delete(tag) : tags.add(tag);
        chip.setAttribute('aria-pressed', String(tags.has(tag)));
      });
      tagRow.append(chip);
    }

    const save = () => handlers.onSave({ text: text.value.trim(), kind: composer.kind, tags: [...tags] });
    text.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handlers.onCancel();
      }
    });

    const el = h('div', { class: 'composer' },
      h('div', { class: 'composer-context' }, h('span', { class: 'composer-badge' }, '+'), context || 'Commentaire général'),
      kinds,
      text,
      tagRow,
      h('div', { class: 'composer-actions' },
        h('span', { class: 'hint' }, '↵ ajouter · ⇧↵ à la ligne · Échap annuler'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: handlers.onCancel }, 'Annuler'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, 'Ajouter')),
    );
    composer = { el, kind, text };
    composerSlot.replaceChildren(el);
    setKind(kind);
    requestAnimationFrame(() => text.focus());
  }

  function closeComposer() {
    composer = null;
    composerSlot.replaceChildren();
  }

  const placeholderFor = (kind) =>
    ({ fix: 'Qu’est-ce qui ne va pas, et ce que tu voudrais à la place ?', like: 'Qu’est-ce qui te plaît ici ? Claude le retiendra.', idea: 'Une piste à essayer ?' })[kind];

  // ------------------------------------------------------------------ liste
  function card(c, ctx) {
    const { media, numbers, selectedId } = ctx;
    const n = numbers.get(c.id);
    const editing = editingId === c.id;
    const body = editing ? editor(c) : h('p', { class: 'card-text' }, c.text || h('em', {}, 'Sans texte : la capture parle d’elle-même.'));

    const actions = h('div', { class: 'card-actions' });
    if (c.status === 'open' && !editing) {
      actions.append(h('button', { class: 'icon-btn', title: 'Modifier', 'aria-label': 'Modifier', onclick: (e) => (e.stopPropagation(), startEdit(c.id)) }, icon('edit', 14)));
    }
    actions.append(h('button', {
      class: 'icon-btn', title: 'Supprimer', 'aria-label': 'Supprimer',
      onclick: (e) => {
        e.stopPropagation();
        if (c.batch == null || confirm('Ce commentaire a déjà été envoyé à Claude. Le supprimer quand même ?')) handlers.onDelete(c.id);
      },
    }, icon('trash', 14)));

    const reply = c.reply || c.status === 'done' || c.status === 'wontfix' || c.status === 'validated'
      ? h('div', { class: `reply reply-${c.status}` },
          h('div', { class: 'reply-head' }, icon('sparkle', 12), c.status === 'wontfix' ? 'Claude · pas appliqué' : c.status === 'validated' ? 'Validé' : 'Claude · traité'),
          c.reply ? h('p', {}, c.reply) : null,
          c.status === 'done' || c.status === 'wontfix'
            ? h('div', { class: 'reply-actions' },
                h('button', { class: 'btn btn-small', onclick: (e) => (e.stopPropagation(), handlers.onPatch(c.id, { status: 'validated' })) }, icon('check', 13), 'Valider'),
                h('button', { class: 'btn btn-small btn-ghost', onclick: (e) => (e.stopPropagation(), handlers.onPatch(c.id, { status: 'open' })) }, icon('undo', 13), 'Rouvrir'))
            : null)
      : null;

    const meta = [];
    if (c.mediaRev !== media.rev) meta.push(`v${c.mediaRev}`);
    if (c.time != null && hasTime(media) && media.fps) meta.push(`image ${frameOf(c.time, media.fps)}`);

    return h('article', {
      class: `card kind-${c.kind}${c.id === selectedId ? ' selected' : ''}${c.status === 'validated' ? ' validated' : ''}`,
      'data-id': c.id,
      tabindex: 0,
      onclick: () => handlers.onSelect(c.id),
    },
      h('header', { class: 'card-head' },
        h('span', { class: 'num' }, String(n ?? '')),
        h('span', { class: 'kind-label' }, KINDS[c.kind].label),
        actions),
      where(c, media) || meta.length
        ? h('div', { class: 'card-where' }, where(c, media), meta.length ? h('span', { class: 'card-meta' }, meta.join(' · ')) : null)
        : null,
      body,
      c.tags?.length ? h('div', { class: 'card-tags' }, c.tags.map((t) => h('span', { class: 'tag tag-static' }, t))) : null,
      c.snap ? h('a', { class: 'snap', href: `/${c.snap}?v=${encodeURIComponent(c.updatedAt || c.createdAt)}`, target: '_blank', onclick: (e) => e.stopPropagation() },
        h('img', { src: `/${c.snap}?v=${encodeURIComponent(c.updatedAt || c.createdAt)}`, alt: 'Capture annotée envoyée à Claude', loading: 'lazy' })) : null,
      c.reopened && c.status === 'open' ? h('p', { class: 'reopened' }, '↺ Rouvert après la réponse de Claude') : null,
      reply,
    );
  }

  function editor(c) {
    const area = h('textarea', { class: 'composer-text', rows: 3 });
    area.value = c.text;
    const commit = () => {
      editingId = null;
      handlers.onPatch(c.id, { text: area.value.trim() });
    };
    area.addEventListener('click', (e) => e.stopPropagation());
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        editingId = null;
        handlers.onRefresh();
      }
    });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
    return area;
  }

  function startEdit(id) {
    editingId = id;
    handlers.onRefresh();
  }

  function group(title, items, ctx, note) {
    if (!items.length) return null;
    return h('section', { class: 'group' },
      h('h3', { class: 'group-title' }, title, h('span', { class: 'group-count' }, String(items.length)), note ? h('span', { class: 'group-note' }, note) : null),
      items.map((c) => card(c, ctx)));
  }

  function render(ctx) {
    snapshot = ctx;
    const { media, comments, listening } = ctx;
    const open = comments.filter((c) => c.status !== 'validated');
    head.replaceChildren(
      h('h2', {}, 'Commentaires'),
      h('span', { class: 'panel-count' }, media ? `${open.length} en cours` : ''),
    );
    if (!media) {
      list.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'Aucun média ouvert.'), h('p', { class: 'muted' }, 'Ajoute un fichier, un dossier ou une URL dans la colonne de gauche.')));
      return;
    }
    const drafts = comments.filter((c) => c.status === 'open' && c.batch == null);
    const sent = comments.filter((c) => c.status === 'open' && c.batch != null);
    const treated = comments.filter((c) => c.status === 'done' || c.status === 'wontfix');
    const validated = comments.filter((c) => c.status === 'validated');

    const sections = [
      group('À envoyer', drafts, ctx),
      group('Chez Claude', sent, ctx, sent.every((c) => ctx.delivered.has(c.batch)) ? 'reçu, en cours' : listening ? 'en route' : 'en attente qu’il écoute'),
      group('Traités · à vérifier', treated, ctx),
    ].filter(Boolean);

    if (validated.length) {
      sections.push(h('button', { class: 'toggle-validated', onclick: () => ((showValidated = !showValidated), render(snapshot)) },
        showValidated ? `Masquer les validés (${validated.length})` : `Voir les validés (${validated.length})`));
      if (showValidated) sections.push(group('Validés', validated, ctx));
    }
    if (!comments.length) sections.push(emptyHelp(media));
    list.replaceChildren(...sections);
    list.querySelector('.card.selected')?.scrollIntoView({ block: 'nearest' });
  }

  function emptyHelp(media) {
    const timed = hasTime(media);
    return h('div', { class: 'empty' },
      h('p', {}, 'Pas encore de commentaire.'),
      h('ul', { class: 'shortcuts' },
        media.kind !== 'audio' ? h('li', {}, h('kbd', {}, 'P'), h('kbd', {}, 'R'), h('kbd', {}, 'A'), h('kbd', {}, 'D'), ' dessine un point, une zone, une flèche ou un tracé') : null,
        h('li', {}, h('kbd', {}, 'C'), timed ? ' commente l’instant présent' : ' ajoute un commentaire général'),
        timed ? h('li', {}, h('kbd', {}, 'I'), h('kbd', {}, 'O'), ' ou ⇧ + glisser sur la timeline : une plage') : null,
        timed ? h('li', {}, h('kbd', {}, '←'), h('kbd', {}, '→'), media.kind === 'video' ? ' image par image · ' : ' pas à pas · ', h('kbd', {}, 'Espace'), ' lecture') : null,
        h('li', { class: 'like-hint' }, h('strong', {}, 'J’aime'), ' compte autant qu’une correction : c’est ce qui apprend tes goûts à Claude.')));
  }

  return {
    render,
    openComposer,
    closeComposer,
    get composing() {
      return Boolean(composer);
    },
    get editing() {
      return Boolean(editingId);
    },
  };
}
