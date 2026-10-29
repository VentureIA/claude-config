# Config Claude Code · Venture IA

Les outils maison de Venture IA pour [Claude Code](https://claude.com/claude-code), installables en une commande, sans compte GitHub.

## Installer (ou mettre à jour)

Ouvre le Terminal (sur Mac : Applications › Utilitaires › Terminal), colle cette ligne et appuie sur Entrée :

```bash
curl -fsSL https://raw.githubusercontent.com/VentureIA/claude-config/main/install.sh | bash
```

L'installateur :

1. installe Claude Code s'il n'est pas déjà là (installateur officiel d'Anthropic) ;
2. installe Bun si ni Node 18+ ni Bun ne sont présents (sans droits administrateur) ;
3. copie les skills dans `~/.claude/skills/`. Un skill du même nom déjà présent est mis de côté, jamais écrasé.

Relancer la même commande met à jour. Il faut ensuite un compte Claude pour se connecter au premier lancement de `claude`.

## Ce qui est inclus

| Skill | À quoi ça sert |
| --- | --- |
| `/studio` | Studio de revue local pour les montages vidéo, le motion design, les visuels, le son et les pages web. Tu commentes sur une timeline image par image, tu dessines sur l'image (point, zone, flèche, crayon), tu marques ce que tu aimes, puis tu envoies tes retours à Claude d'un clic. Claude corrige et retient tes goûts dans `~/.claude/studio/gouts.md`. |

## Utiliser /studio

```bash
cd ~/Documents/MonMontage   # le dossier de ton projet
claude
```

Puis tape `/studio` (ou `/studio ma-video.mp4`). Le studio s'ouvre dans ton navigateur, sur ta machine uniquement.

Raccourcis : `P` point, `R` zone, `A` flèche, `D` crayon, `C` commenter l'instant, `I`/`O` une plage, `←`/`→` image par image, `Espace` lecture.

Facultatif : avec [ffmpeg](https://ffmpeg.org) (`brew install ffmpeg` sur Mac), la timeline affiche la pellicule et la forme d'onde.

## Désinstaller

```bash
curl -fsSL https://raw.githubusercontent.com/VentureIA/claude-config/main/install.sh | bash -s -- --uninstall
```

## Windows

L'installateur fonctionne dans WSL ou Git Bash. Sous Windows, installe d'abord Claude Code depuis PowerShell : `irm https://claude.ai/install.ps1 | iex`.
