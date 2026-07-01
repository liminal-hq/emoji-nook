#!/usr/bin/env bash
# (c) Copyright 2026 Liminal HQ, Scott Morris
# SPDX-License-Identifier: Apache-2.0 OR MIT
#
# Installs a development .desktop file so xdg-desktop-portal can identify the
# app by its bundle ID (ca.liminalhq.emoji-nook) during local testing.
# Required for Wayland GlobalShortcuts portal integration to work in dev.
#
# Run once after cloning; re-run if the repo moves.
# Undo with: pnpm desktop:uninstall

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="ca.liminalhq.emoji-nook"
BINARY="${REPO_ROOT}/target/debug/emoji-picker"
ICON="${REPO_ROOT}/apps/emoji-picker/src-tauri/icons/128x128.png"
DESKTOP_DIR="${HOME}/.local/share/applications"
DESKTOP_FILE="${DESKTOP_DIR}/${APP_ID}.desktop"

mkdir -p "${DESKTOP_DIR}"

cat > "${DESKTOP_FILE}" <<EOF
[Desktop Entry]
Name=Emoji Nook (dev)
Comment=Native Linux emoji picker — development build
Exec=${BINARY}
Icon=${ICON}
Type=Application
Categories=Utility;
NoDisplay=false
StartupNotify=false
EOF

if command -v update-desktop-database &>/dev/null; then
    update-desktop-database "${DESKTOP_DIR}"
fi

echo "Installed: ${DESKTOP_FILE}"
echo "Binary:    ${BINARY}"
echo ""
echo "Build the debug binary first if it does not exist:"
echo "  pnpm tauri:dev  (or)  cargo build -p emoji-picker"
