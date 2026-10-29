#!/usr/bin/env bash
# ============================================================
# Config Claude Code de Venture IA — installation en une commande
# ============================================================
#   curl -fsSL https://raw.githubusercontent.com/VentureIA/claude-config/main/install.sh | bash
#
# Relancer la même commande met à jour. Pour désinstaller :
#   curl -fsSL https://raw.githubusercontent.com/VentureIA/claude-config/main/install.sh | bash -s -- --uninstall
#
# Ni compte GitHub, ni git, ni Homebrew : seulement curl et tar, présents sur macOS et Linux.
# ============================================================

set -euo pipefail

REPO="VentureIA/claude-config"
BRANCH="main"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SKILLS_DIR="$CLAUDE_DIR/skills"
MANIFEST="$CLAUDE_DIR/.venture-config-skills"
TS=$(date +%Y%m%d-%H%M%S)

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[2m'
RST='\033[0m'
ok()   { printf "  ${GREEN}✓${RST} %s\n" "$1"; }
warn() { printf "  ${YELLOW}⚠${RST} %s\n" "$1"; }
err()  { printf "  ${RED}✗${RST} %s\n" "$1"; }
hr()   { printf "\n${DIM}━━━ %s ━━━${RST}\n" "$1"; }

case "$(uname -s)" in
  Darwin) OS=mac ;;
  Linux)  OS=linux ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows ;;
  *) OS=other ;;
esac

# ------------------------------------------------------------ désinstallation
if [ "${1:-}" = "--uninstall" ]; then
  hr "Désinstallation"
  if [ -f "$MANIFEST" ]; then
    while IFS= read -r name; do
      [ -n "$name" ] && rm -rf "${SKILLS_DIR:?}/$name" && ok "skill $name retiré"
    done < "$MANIFEST"
    rm -f "$MANIFEST"
  else
    warn "Rien à désinstaller."
  fi
  echo "  Tes goûts appris par /studio restent dans $CLAUDE_DIR/studio/ (supprime le dossier si tu veux)."
  exit 0
fi

printf "\n${GREEN}Config Claude Code · Venture IA${RST}\n"

# ------------------------------------------------------------ 1. Claude Code
hr "Claude Code"
if command -v claude >/dev/null 2>&1 || [ -x "$HOME/.local/bin/claude" ]; then
  ok "déjà installé"
elif [ "$OS" = windows ]; then
  warn "Installe d'abord Claude Code depuis PowerShell : irm https://claude.ai/install.ps1 | iex"
else
  echo "  ↳ installation avec l'installateur officiel d'Anthropic"
  curl -fsSL https://claude.ai/install.sh | bash
  ok "Claude Code installé"
fi

# ------------------------------------------------------------ 2. Moteur pour /studio (Node 18+ ou Bun)
hr "Moteur du studio"
node_ok() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]
}
if node_ok; then
  ok "Node $(node -v)"
elif command -v bun >/dev/null 2>&1 || [ -x "$HOME/.bun/bin/bun" ]; then
  ok "Bun"
elif [ "$OS" = windows ]; then
  warn "Installe Bun depuis PowerShell : powershell -c \"irm bun.sh/install.ps1 | iex\""
else
  echo "  ↳ installation de Bun (sans droits administrateur)"
  curl -fsSL https://bun.sh/install | bash >/dev/null
  ok "Bun installé dans ~/.bun"
fi

# ------------------------------------------------------------ 3. Téléchargement
hr "Skills"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if [ -n "${VENTURE_CONFIG_SRC:-}" ]; then
  SRC="$VENTURE_CONFIG_SRC" # pour tester depuis une copie locale
else
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$TMP"
  SRC="$TMP/$(ls "$TMP" | head -1)"
fi
[ -d "$SRC/skills" ] || { err "Téléchargement incomplet. Vérifie ta connexion et relance."; exit 1; }

# ------------------------------------------------------------ 4. Installation des skills
# Un dossier du même nom qui ne vient pas de cet installateur est mis de côté, jamais écrasé.
mkdir -p "$SKILLS_DIR"
installed=()
for dir in "$SRC"/skills/*/; do
  name=$(basename "$dir")
  target="$SKILLS_DIR/$name"
  if [ -e "$target" ] || [ -L "$target" ]; then
    if grep -qx "$name" "$MANIFEST" 2>/dev/null; then
      rm -rf "$target"
    else
      mkdir -p "$CLAUDE_DIR/.venture-config-backup/$TS"
      mv "$target" "$CLAUDE_DIR/.venture-config-backup/$TS/$name"
      warn "ancien $name mis de côté dans $CLAUDE_DIR/.venture-config-backup/$TS/"
    fi
  fi
  cp -R "$dir" "$target"
  installed+=("$name")
  ok "/$name"
done
printf "%s\n" ${installed[@]+"${installed[@]}"} > "$MANIFEST"

# ------------------------------------------------------------ 5. Facultatif
hr "Facultatif"
if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg (pellicule et forme d'onde dans /studio)"
else
  warn "ffmpeg absent : /studio marche sans, mais sans pellicule ni forme d'onde."
  [ "$OS" = mac ] && echo "    Pour l'ajouter plus tard : brew install ffmpeg"
fi

# ------------------------------------------------------------ Fin
hr "C'est prêt"
cat <<'EOF'

  1. Ouvre un nouveau Terminal (pour que les outils installés soient pris en compte).
  2. Va dans le dossier de ton projet, par exemple : cd ~/Documents/MonMontage
  3. Lance Claude Code : claude
  4. Tape /studio pour ouvrir le studio de revue sur tes vidéos, visuels ou sons.

  Mise à jour : relance la même commande d'installation.

EOF
