#!/usr/bin/env bash
# (c) Copyright 2026 Liminal HQ, Scott Morris
# SPDX-License-Identifier: Apache-2.0 OR MIT
#
# Removes the development .desktop file installed by dev-desktop-install.sh.

set -euo pipefail

APP_ID="ca.liminalhq.emoji-nook"
DESKTOP_DIR="${HOME}/.local/share/applications"
DESKTOP_FILE="${DESKTOP_DIR}/${APP_ID}.desktop"

if [[ ! -f "${DESKTOP_FILE}" ]]; then
    echo "Nothing to remove: ${DESKTOP_FILE} does not exist."
    exit 0
fi

rm "${DESKTOP_FILE}"

if command -v update-desktop-database &>/dev/null; then
    update-desktop-database "${DESKTOP_DIR}"
fi

echo "Removed: ${DESKTOP_FILE}"
