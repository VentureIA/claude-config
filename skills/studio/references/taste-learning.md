# Apprendre les goûts à partir des retours

Après chaque série traitée, relis les commentaires et décide pour chacun s'il révèle un goût. Le but : qu'à la prochaine créa, pour n'importe quel client, l'utilisateur ait moins à corriger.

## Le tri

Pose la question : « Sur une autre vidéo, pour un autre client, ce retour s'appliquerait-il ? »

- **Oui** → `~/.claude/studio/gouts.md` (ses goûts à lui).
- **Seulement pour cette marque ou ce client** (charte, logo, ton, police imposée) → `<projet>/.studio/gouts.md`. Crée le fichier au besoin, avec un titre `# Ce projet · <nom>` et les mêmes sections que le fichier global.
- **Non** (correction ponctuelle : « remonte ce texte de 20 px », une coquille, un nom) → rien.

## Écrire une règle

- **Nomme la propriété, pas l'objet.** « Contraste chaud/froid marqué au premier plan », pas « les fleurs ».
- **Rends-la applicable**, avec des chiffres quand ta correction en a révélé : « Marge d'au moins 8 % de la largeur autour des titres », plutôt que « plus d'air ».
- **Un J'AIME compte autant qu'une correction.** C'est le signal le plus fiable : écris précisément ce qui plaît et range-le dans sa section thématique, ou dans « Ce que j'adore » s'il n'en a pas.
- **N'invente rien** au-delà de ce que le commentaire et ta correction montrent.

Format d'une ligne, dans la bonne section :

```
- ✓ Règle courte et applicable. _(Projet · c_xxxxxx · AAAA-MM-JJ)_
```

La parenthèse finale donne la provenance : le studio l'affiche en discret et se sert de la date pour la liste « Appris ces 14 derniers jours ».

## Consolider

- **Règle déjà présente** : ne la duplique pas. Si le nouveau retour vient d'une autre série ou d'un autre projet, passe-la de ✓ à ✓✓ et ajoute la source dans la parenthèse, en gardant la date la plus récente à la fin : `_(Skanio RENT · c_8f2a · Florian reel · c_91bb · 2026-10-22)_`.
- **Contradiction** : n'écrase pas en silence. Si le contexte explique les deux, précise la règle (« fondus pour les plans d'ambiance, coupes sèches sur le rythme »). Sinon, remplace-la et dis-le à l'utilisateur en une ligne.
- **Reste lisible** : une douzaine de lignes par section au plus. Fusionne ce qui se recoupe et retire ce que l'utilisateur a supprimé ou contredit.
- **Ne touche pas aux lignes écrites par l'utilisateur** sans le lui dire.

## Le dire

Termine ton résumé par une ligne « Appris : … » (ou « Rien de nouveau à retenir »). Dans l'onglet Goûts du studio, l'utilisateur voit ces lignes sous « Appris ces 14 derniers jours » et peut supprimer d'un clic celles qui sont fausses.
