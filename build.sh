#!/usr/bin/env bash
# Build a .streamDeckPlugin zip for distribution.
# OpenDeck (and Elgato) never run `npm install`, so node_modules ships inside the zip.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="me.dwot.keylight"
VERSION=$(node -p "require('$SCRIPT_DIR/package.json').version")

DIST_DIR="$SCRIPT_DIR/dist"
STAGE_DIR="$DIST_DIR/${PLUGIN_NAME}.sdPlugin"

rm -rf "$DIST_DIR"
mkdir -p "$STAGE_DIR"

# Copy only what the plugin needs at runtime (plus README/LICENSE/CHANGELOG).
rsync -a \
	--include='/bin/***' \
	--include='/propertyInspector/***' \
	--include='/icons/' --include='/icons/actions/' --include='/icons/actions/*.png' \
	--include='/icons/*.png' \
	--include='/manifest.json' --include='/manifest.linux.json' --include='/package.json' --include='/package-lock.json' \
	--include='/README.md' --include='/LICENSE' --include='/CHANGELOG.md' \
	--exclude='*' \
	"$SCRIPT_DIR/" "$STAGE_DIR/"

# Install the pinned production deps inside the staged copy.
( cd "$STAGE_DIR" && npm ci --omit=dev --no-audit --no-fund )

# Zip it. The top-level folder name is the plugin UUID OpenDeck uses.
ARTIFACT="$DIST_DIR/${PLUGIN_NAME}-${VERSION}.streamDeckPlugin"
( cd "$DIST_DIR" && zip -r -X "$(basename "$ARTIFACT")" "$(basename "$STAGE_DIR")" -q )

echo "Built: $ARTIFACT"
