# Emoji Nook

A native Linux emoji picker built with Tauri v2 and React 19, designed to blend seamlessly with GNOME, KDE, and other desktop environments.

Emoji Nook runs in the background and pops up on a global shortcut, letting you search for and select an emoji that gets injected into the previously focused application. The picker adapts to your desktop's colour scheme, accent colour, and font preferences via `xdg-desktop-portal`.

> **Status:** Early development — the picker UI and theme detection are functional; global shortcuts, emoji injection, and window management are planned.

## Architecture

This repository is a `pnpm` + Cargo workspace monorepo.

- `apps/emoji-picker/` — React 19 + TypeScript frontend
- `apps/emoji-picker/src-tauri/` — Rust/Tauri v2 backend
- `plugins/xdg-portal/` — Custom Tauri plugin bridging `xdg-desktop-portal` via `ashpd`
- `plugins/xdg-portal/guest-js/` — TypeScript guest API for the plugin

### Key dependencies

| Layer | Library | Purpose |
|-------|---------|---------|
| Emoji | [Frimousse](https://github.com/liveblocks/frimousse) v0.3 | Headless, React 19 compatible emoji picker |
| Portal | [ashpd](https://github.com/bilelmoussaoui/ashpd) | D-Bus interface to `xdg-desktop-portal` |
| Framework | [Tauri](https://v2.tauri.app/) v2 | Desktop application shell |
| Logging | tauri-plugin-log | Structured logging with console bridge |

### Desktop theme support

The picker reads your desktop's colour scheme, accent colour, and environment from `xdg-desktop-portal` Settings and applies a matching token set:

- **Adwaita** — GNOME, Cinnamon, MATE, XFCE (Cantarell font, rounded corners)
- **Breeze** — KDE Plasma (Noto Sans font, tighter radii)

Falls back to CSS `prefers-color-scheme` when portal access is unavailable.

## Getting started

### Prerequisites

- Node.js 20+
- `pnpm`
- Rust (stable)
- Linux system dependencies for Tauri v2:
  ```
  libwebkit2gtk-4.1-dev build-essential libssl-dev libgtk-3-dev
  libayatana-appindicator3-dev librsvg2-dev
  ```

### Setup

```bash
pnpm install
```

### Run

```bash
pnpm tauri:dev
```

### Build

```bash
pnpm tauri:build
```

## Licence

Dual-licenced under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) or [MIT](https://opensource.org/licenses/MIT), at your option.

(c) 2026 Liminal HQ, Scott Morris
