# Linux Setup Guide

Emoji Nook needs a few system tools to inject emojis into applications. The exact requirements depend on your desktop environment and display server.

## Quick Setup

Run the setup script from the repo root:

```bash
./scripts/setup-linux.sh
```

This detects your distro and installs the necessary packages.

## Manual Setup

### Required: Emoji Injection

Emoji Nook uses a clipboard shuffle to paste emojis: it copies the emoji to your clipboard, simulates Ctrl+V, then restores your original clipboard. The Ctrl+V simulation needs one of these tools (tried in this order):

#### 1. `ydotool` (recommended — works everywhere)

Works on X11, Wayland, GNOME, KDE, Sway, Hyprland, etc. Uses kernel `/dev/uinput` so it bypasses all display server restrictions.

**Arch Linux:**

```bash
sudo pacman -S ydotool
sudo usermod -aG input $USER
# Log out and back in for the group change to take effect, then:
systemctl --user enable --now ydotool
```

**Ubuntu/Debian:**

```bash
sudo apt install ydotool
sudo usermod -aG input $USER
# Log out and back in, then:
systemctl --user enable --now ydotool
```

**Fedora:**

```bash
sudo dnf install ydotool
sudo usermod -aG input $USER
# Log out and back in, then:
systemctl --user enable --now ydotool
```

> **Note:** `ydotool` requires the `ydotool` user service running (`ydotoold` daemon). The `systemctl --user enable --now ydotool` command starts it and ensures it runs on login.

#### 2. `wtype` (Wayland native, but not GNOME)

Works on Sway, Hyprland, and other compositors that support the `wl_virtual_keyboard` protocol. **Does not work on GNOME** (GNOME doesn't implement this protocol).

**Arch Linux:**

```bash
sudo pacman -S wtype
```

**Ubuntu/Debian:**

```bash
sudo apt install wtype
```

#### 3. `xdotool` (X11 / XWayland only)

Works on X11 sessions. On Wayland, it only reaches XWayland clients (e.g., Firefox, Electron apps) — not native Wayland apps like GNOME Terminal.

**Arch Linux:**

```bash
sudo pacman -S xdotool
```

**Ubuntu/Debian:**

```bash
sudo apt install xdotool
```

**Fedora:**

```bash
sudo dnf install xdotool
```

### Alternative: IBus Input Method

If you use IBus as your input method framework, emojis can be entered natively without any of the above tools:

- **GNOME** ships IBus by default. Press **Ctrl+.** (Ctrl+period) to open the built-in emoji picker, or use `ibus emoji` from the command line.
- To add custom emoji input methods, install `ibus-uniemoji`:

**Arch Linux:**

```bash
# From the AUR
yay -S ibus-uniemoji
```

**Ubuntu/Debian:**

```bash
sudo apt install ibus-uniemoji
```

> **Note:** Emoji Nook does not currently inject via IBus — it uses the clipboard shuffle approach. IBus integration is planned for a future release as an alternative injection backend.

## Cleanup Guide

If you want to remove the tools installed for Emoji Nook:

### Arch Linux

```bash
# Remove packages
sudo pacman -Rs ydotool wtype xdotool

# Stop and disable the ydotool service
systemctl --user disable --now ydotool

# Remove yourself from the input group (optional)
sudo gpasswd -d $USER input
```

### Ubuntu/Debian

```bash
sudo apt remove --purge ydotool wtype xdotool
systemctl --user disable --now ydotool
sudo gpasswd -d $USER input
```

### Fedora

```bash
sudo dnf remove ydotool xdotool
systemctl --user disable --now ydotool
sudo gpasswd -d $USER input
```

## Troubleshooting

### Emoji copies to clipboard but doesn't paste automatically

Check which tool is available and working:

```bash
# Test ydotool (should type "hello" into the focused window after 3s)
sleep 3 && ydotool type "hello"

# Test wtype
sleep 3 && wtype "hello"

# Test xdotool
sleep 3 && xdotool type "hello"
```

Run one of these, quickly click into a text field, and see if "hello" appears.

### `ydotool` says "permission denied" or similar

Make sure:

1. Your user is in the `input` group: `groups $USER` should include `input`
2. You logged out and back in after adding the group
3. The `ydotool` user service is running: `systemctl --user status ydotool`

### `wtype` says "Compositor does not support the virtual keyboard protocol"

Your compositor (likely GNOME) doesn't support `wl_virtual_keyboard`. Use `ydotool` instead.

### `xdotool` triggers a "Remote Desktop" permission prompt on Wayland

This is expected — `xdotool` goes through XWayland which triggers the portal prompt. Use `ydotool` instead to avoid this.
