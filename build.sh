#!/usr/bin/env bash
# Build a .streamDeckPlugin zip for distribution.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="me.dwot.keylight"
VERSION=$(python3 -c "import json; print(json.load(open('$SCRIPT_DIR/manifest.json'))['Version'])")

DIST_DIR="$SCRIPT_DIR/dist"
STAGE_DIR="$DIST_DIR/${PLUGIN_NAME}.sdPlugin"

rm -rf "$DIST_DIR"
mkdir -p "$STAGE_DIR"

# Copy plugin source, excluding dev artifacts.
rsync -a --exclude=node_modules --exclude=dist --exclude='.git*' \
	--exclude='*.tar.gz' --exclude='*.streamDeckPlugin' \
	"$SCRIPT_DIR/" "$STAGE_DIR/"

# Install production deps inside the staged copy.
( cd "$STAGE_DIR" && npm install --omit=dev --no-audit --no-fund )

# Zip it.
ARTIFACT="$DIST_DIR/${PLUGIN_NAME}-${VERSION}.streamDeckPlugin"
( cd "$DIST_DIR" && zip -r "$(basename "$ARTIFACT")" "$(basename "$STAGE_DIR")" -q )

echo "Built: $ARTIFACT"
