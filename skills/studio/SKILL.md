---
name: studio
description: Ouvre le studio de revue local (/studio) pour commenter un montage vidéo, un motion design (Remotion), un visuel, un son ou une page web locale — timeline image par image, annotations dessinées, « J'aime » — et renvoyer les retours à Claude, qui les traite puis apprend les goûts de l'utilisateur. Charge aussi ce skill avant tout montage, motion design ou création visuelle pour appliquer le fichier de goûts (~/.claude/studio/gouts.md), et quand l'utilisateur parle de ses retours du studio.
argument-hint: "[fichiers, dossier ou URL à relire]"
---

# Studio de revue

Une page locale (http://localhost:4747, 127.0.0.1 uniquement) où l'utilisateur relit une créa, dessine ses retours dessus et les envoie à Claude d'un clic. Rien n'est publié.

```
CLI="node <dossier de ce skill>/server/studio.mjs"     # toutes les commandes prennent --dir "<projet>" (défaut : dossier courant)
```

Le dossier de ce skill est le « Base directory » affiché quand le skill se charge (souvent `~/.claude/skills/studio`). Le studio tourne avec Node 18+ ou avec Bun : si `node` est absent, remplace `node` par `bun` (souvent `~/.bun/bin/bun`). ffmpeg et ffprobe sont facultatifs.

| Où | Quoi |
| --- | --- |
| `<projet>/.studio/review.json` | médias, commentaires, réponses, séries envoyées |
| `<projet>/.studio/snaps/<id>.png` | l'image exacte commentée, avec le dessin de l'utilisateur |
| `~/.claude/studio/gouts.md` | ses goûts, tous projets confondus |
| `<projet>/.studio/gouts.md` | la charte et les contraintes du client ou de la marque (facultatif) |

## Deux façons d'arriver ici

- **`/studio [médias]`** : ouvrir une revue → « Ouvrir une revue ».
- **Chargé pendant une créa, sans `/studio`** : lis seulement les goûts (« Avant de créer »). Quand un rendu est prêt, propose en une ligne d'ouvrir le studio.

## Avant de créer

Lis `~/.claude/studio/gouts.md`, puis `<projet>/.studio/gouts.md` s'il existe. Les ✓✓ sont des règles, les ✓ des préférences fortes. Pour la charte d'un client, le fichier du projet l'emporte. Si la demande contredit un goût, suis la demande et signale-le en une ligne.

## Ouvrir une revue

1. **Projet** : le dossier courant, sauf indication contraire.
2. **Médias** : ceux passés en argument (fichiers, dossiers entiers, URL `http://localhost:…`). Sans argument :
   - projet Remotion (`remotion` dans `package.json`) : le rendu le plus récent de `out/`. S'il est absent ou plus ancien que `src/`, rends-le d'abord avec le script du projet (`npm run render`…), en arrière-plan s'il est long ;
   - sinon, le visuel ou la vidéo le plus récent du projet. En cas de doute, demande lequel.
3. **Lance** : `$CLI start --dir "<projet>" <médias…> [--url http://localhost:3000] [--title "Nom lisible"]`. Le studio s'ouvre dans le navigateur ; s'il tourne déjà pour ce projet, il est réutilisé et les médias s'ajoutent.
4. Si le projet est un dépôt git et que `.studio/` n'est pas ignoré, ajoute `.studio/` au `.gitignore`.
5. **Écoute** : lance `$CLI wait --dir "<projet>"` avec `run_in_background: true`. Cette tâche se termine toute seule quand l'utilisateur clique « Envoyer à Claude », et sa sortie contient les retours. Ne la sonde pas : tu seras réveillé.
6. Dis à l'utilisateur, en deux ou trois lignes : l'adresse, l'essentiel des raccourcis (P point, R zone, A flèche, D crayon, C commenter l'instant, I/O une plage, ←/→ image par image) et qu'un « J'aime » t'apprend autant qu'une correction.

## Quand les retours arrivent

La sortie de `wait` liste, par média : l'identifiant, le type (À CORRIGER, J'AIME, IDÉE), le timecode et le numéro d'image, la forme dessinée en % et en pixels, les tags, et le chemin de la capture annotée.

1. **Regarde chaque capture** (Read sur le PNG) avant de toucher au code : le dessin montre exactement ce qui est visé.
2. **Retrouve la source** :
   - Remotion : l'image N du rendu est l'image N de la composition. Trouve la `<Sequence>` qui la couvre (`from`, `durationInFrames`, fichier de minutage du projet). Les pixels du rendu sont ceux de la composition.
   - Visuel, HTML, CSS : la position en pixels désigne l'élément. Pour une page web, reproduis la taille de fenêtre indiquée et fais ta propre capture avant de corriger.
   - Audio : le timecode situe la voix, la musique ou le bruitage.
3. **Selon le type** :
   - À CORRIGER : corrige.
   - IDÉE : essaie si c'est rapide et cohérent avec ses goûts, sinon propose.
   - J'AIME : ne change rien à cet endroit, protège-le dans les prochaines versions.
4. **Rends à nouveau vers le même fichier** : le studio recharge seul la nouvelle version (v2, v3…) et les commentaires restent à leur place. Si tu rends vers un nouveau fichier, ajoute-le : `$CLI add --dir "<projet>" <fichier>`.
5. **Réponds à chaque commentaire**, en une phrase concrète (quoi, où, avant → après) :
   `$CLI reply <id> done "Titre décalé de 40 px vers le haut, marge portée à 8 % (Act2.tsx)" --dir "<projet>"`
   `wontfix` avec la raison si tu n'appliques pas. Pour un J'AIME : `done "Retenu dans tes goûts : …"`. L'utilisateur valide ou rouvre dans le studio. Un commentaire rouvert te revient avec ta réponse précédente.
6. **Apprends** : mets à jour les fichiers de goûts en suivant [taste-learning.md](references/taste-learning.md).
7. **Relance l'écoute** (`wait` en arrière-plan), puis résume en trois lignes au plus : ce qui a changé, ce que tu as appris, la version chargée dans le studio.

## Retours non envoyés

Si l'utilisateur dit « lis mes retours » sans avoir cliqué « Envoyer » : `$CLI pending --dir "<projet>"` affiche tous les retours ouverts, envoyés ou non. Traite-les de la même façon.

## Commandes

| Commande | Effet |
| --- | --- |
| `start [médias] [--url u] [--title t] [--no-open]` | démarre ou réutilise le studio du projet, ajoute les médias, ouvre le navigateur |
| `add [médias] [--url u]` | ajoute des médias sans rouvrir le navigateur |
| `wait` | attend le clic « Envoyer à Claude », puis affiche les retours |
| `pending` | affiche tous les retours ouverts |
| `reply <id> done\|wontfix\|open "note"` | répond à un commentaire (visible dans le studio) |
| `status` / `stop` | état du studio / le fermer (la revue reste sur disque) |

## Règles

- Ne modifie jamais `review.json` à la main pendant que le studio tourne : il serait écrasé. Passe par `reply`.
- Le studio survit à la session Claude. Rouvrir `/studio` dans le même projet reprend la revue là où elle en était.
- Formats : vidéo mp4, mov, webm ; image png, jpg, gif, webp, svg, avif ; audio mp3, wav, m4a, aac, ogg, flac ; pages `http(s)://`. ffprobe et ffmpeg donnent la cadence, la taille et la forme d'onde ; sans eux, le studio suppose 30 i/s.
- Si le port 4747 est pris, le studio prend le suivant libre : utilise l'adresse affichée par `start`.
