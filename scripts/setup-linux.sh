#!/usr/bin/env bash
# Install system dependencies for Emoji Nook on Linux.
#
# Usage: ./scripts/setup-linux.sh [--uninstall]
#
# (c) Copyright 2026 Liminal HQ, Scott Morris
# SPDX-License-Identifier: Apache-2.0 OR MIT

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${GREEN}==>${RESET} ${BOLD}$*${RESET}"; }
warn()  { echo -e "${YELLOW}==> WARNING:${RESET} $*"; }
error() { echo -e "${RED}==> ERROR:${RESET} $*" >&2; }

# ---------------------------------------------------------------------------
# Detect package manager
# ---------------------------------------------------------------------------

detect_pm() {
    if command -v pacman &>/dev/null; then
        echo "pacman"
    elif command -v apt &>/dev/null; then
        echo "apt"
    elif command -v dnf &>/dev/null; then
        echo "dnf"
    else
        echo "unknown"
    fi
}

PM=$(detect_pm)

install_pkg() {
    case "$PM" in
        pacman) sudo pacman -S --needed --noconfirm "$@" ;;
        apt)    sudo apt install -y "$@" ;;
        dnf)    sudo dnf install -y "$@" ;;
        *)      error "Unsupported package manager. Install manually: $*"; return 1 ;;
    esac
}

remove_pkg() {
    case "$PM" in
        pacman) sudo pacman -Rs --noconfirm "$@" 2>/dev/null || true ;;
        apt)    sudo apt remove --purge -y "$@" 2>/dev/null || true ;;
        dnf)    sudo dnf remove -y "$@" 2>/dev/null || true ;;
        *)      error "Unsupported package manager. Remove manually: $*"; return 1 ;;
    esac
}

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

do_install() {
    info "Detected package manager: $PM"
    echo

    # ydotool — primary paste simulation tool
    info "Installing ydotool (keyboard simulation via /dev/uinput)..."
    install_pkg ydotool

    if ! groups "$USER" | grep -qw input; then
        info "Adding $USER to the input group..."
        sudo usermod -aG input "$USER"
        warn "You must log out and back in for the group change to take effect."
        warn "After logging back in, run: systemctl --user enable --now ydotool"
    else
        info "User $USER is already in the input group."
        info "Enabling ydotool user service..."
        systemctl --user enable --now ydotool || warn "Failed to start ydotool service. Try after relogin."
    fi

    echo

    # xdotool — fallback for X11/XWayland
    info "Installing xdotool (X11/XWayland fallback)..."
    install_pkg xdotool

    echo

    # wtype — fallback for non-GNOME Wayland compositors
    if [ "$PM" = "pacman" ] || [ "$PM" = "apt" ]; then
        info "Installing wtype (Wayland fallback for Sway/Hyprland)..."
        install_pkg wtype
    else
        warn "wtype not available via $PM — skip if you're on GNOME."
    fi

    echo
    info "Done! Summary:"
    echo "  - ydotool: $(command -v ydotool 2>/dev/null && echo 'installed' || echo 'not found')"
    echo "  - xdotool: $(command -v xdotool 2>/dev/null && echo 'installed' || echo 'not found')"
    echo "  - wtype:   $(command -v wtype 2>/dev/null && echo 'installed' || echo 'not found')"
    echo
    echo "  ydotool service: $(systemctl --user is-active ydotool 2>/dev/null || echo 'inactive')"
    echo

    if ! groups "$USER" | grep -qw input; then
        warn "Remember to log out and back in, then run:"
        echo "  systemctl --user enable --now ydotool"
    fi
}

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

do_uninstall() {
    info "Stopping ydotool service..."
    systemctl --user disable --now ydotool 2>/dev/null || true

    info "Removing packages..."
    remove_pkg ydotool xdotool wtype

    echo
    info "Optionally remove yourself from the input group:"
    echo "  sudo gpasswd -d $USER input"
    echo
    info "Cleanup complete."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--uninstall" ]]; then
    do_uninstall
else
    do_install
fi
