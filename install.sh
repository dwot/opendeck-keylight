#!/usr/bin/env bash
# Install me.dwot.keylight into OpenDeck's plugins directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR_NAME="me.dwot.keylight.sdPlugin"
PLUGIN_SRC="$SCRIPT_DIR"

# OpenDeck plugin paths (Linux). OpenDeck 2.x keeps plugins under its config dir.
NATIVE_DIR="$HOME/.config/opendeck/plugins"
FLATPAK_DIR="$HOME/.var/app/me.amankhanna.opendeck/config/opendeck/plugins"

if [[ -d "$FLATPAK_DIR" ]]; then
	TARGET="$FLATPAK_DIR/$PLUGIN_DIR_NAME"
	echo "Detected Flatpak OpenDeck install."
elif [[ -d "$(dirname "$NATIVE_DIR")" ]]; then
	TARGET="$NATIVE_DIR/$PLUGIN_DIR_NAME"
	echo "Detected native OpenDeck install."
else
	echo "Could not find OpenDeck plugins directory. Run OpenDeck once first, then re-run this script."
	exit 1
fi

mkdir -p "$(dirname "$TARGET")"

if [[ -d "$TARGET" ]]; then
	echo "Removing existing installation at $TARGET"
	rm -rf "$TARGET"
fi

echo "Installing to $TARGET"
mkdir -p "$TARGET"
rsync -a --exclude=node_modules --exclude=dist --exclude='.git*' \
	--exclude='*.tar.gz' --exclude='*.streamDeckPlugin' \
	"$PLUGIN_SRC/" "$TARGET/"

# The only dependency is `ws`. Debian/Ubuntu's node-ws package satisfies it system-wide.
if ( cd "$TARGET" && node -e "require('ws')" ) 2>/dev/null; then
	echo "Node dependency 'ws' already available, skipping npm install."
else
	echo "Installing Node dependencies..."
	( cd "$TARGET" && npm install --omit=dev --no-audit --no-fund )
fi

cat <<EOF

Done.

Next steps:
  1. Restart OpenDeck.
  2. The "Key Light" plugin should appear in the actions sidebar. Lights are
     discovered automatically; if none show up, add their IPs under
     "Manual IPs" in any Key Light action's settings.

Logs (if something goes wrong):
  ~/.local/share/opendeck/logs/plugins/me.dwot.keylight.sdPlugin.log
EOF
