#!/usr/bin/env bash
# Install me.dwot.keylight into OpenDeck's plugins directory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR_NAME="me.dwot.keylight.sdPlugin"
PLUGIN_SRC="$SCRIPT_DIR"

# OpenDeck plugin paths (Linux)
NATIVE_DIR="$HOME/.local/share/opendeck/plugins"
FLATPAK_DIR="$HOME/.var/app/me.amankhanna.opendeck/data/opendeck/plugins"

if [[ -d "$FLATPAK_DIR" ]]; then
	TARGET="$FLATPAK_DIR/$PLUGIN_DIR_NAME"
	echo "Detected Flatpak OpenDeck install."
elif [[ -d "$(dirname "$NATIVE_DIR")" ]] || [[ -d "$NATIVE_DIR" ]]; then
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
cp -r "$PLUGIN_SRC" "$TARGET"

echo "Installing Node dependencies..."
( cd "$TARGET" && npm install --omit=dev --no-audit --no-fund )

cat <<EOF

Done.

Next steps:
  1. Make sure keylight-control is running and its HTTP API is enabled
     (Settings → Advanced → Enable HTTP API).
     Verify: curl http://localhost:27301/api/lights
  2. Restart OpenDeck.
  3. The "Key Light" plugin should appear in the actions sidebar.

Logs (if something goes wrong):
  ~/.local/share/opendeck/logs/
EOF
