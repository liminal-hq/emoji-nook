# Introducing Emoji Nook: A Native Linux Emoji Picker That Actually Feels Native

**TL;DR** — Emoji Nook is an open-source emoji picker for Linux built with Tauri v2 and React 19. It lives in your system tray, pops up on a global shortcut, and pastes your chosen emoji into whatever app you were just using — all while matching your desktop's theme, accent colour, and font.

---

<!-- TODO: Add hero screenshot or animated GIF of the picker in action -->

## The Problem

Linux desktops have come a long way, but emoji input is still a rough edge. GNOME has a built-in picker that's buried behind `Ctrl+.` and doesn't work everywhere. KDE's offering is similarly hidden. And if you're on XFCE, Cinnamon, or a tiling WM? You're mostly on your own.

The workarounds — copy-pasting from a browser, installing an Electron app that eats 200 MB of RAM, or memorising Unicode codepoints — all feel wrong on a platform that's otherwise so customisable.

We wanted something that felt like it shipped with the desktop. Something that blends in.

## What Emoji Nook Is

Emoji Nook is a lightweight, system-wide emoji picker that:

- **Runs in the background** with a system tray icon and near-zero idle footprint
- **Pops up instantly** on a configurable global shortcut (default: `Alt+Shift+E`)
- **Searches fast** with an autofocused search bar powered by Frimousse's emoji dataset
- **Injects the emoji** directly into whatever app had focus — no manual pasting required
- **Matches your desktop** by reading your colour scheme, accent colour, and environment from `xdg-desktop-portal` and applying the right visual tokens

<!-- TODO: Add side-by-side screenshot showing the picker on GNOME dark vs KDE Breeze light -->

It's a 370×380 pixel frameless overlay that appears, does its job, and disappears. That's the whole philosophy: be useful, be fast, get out of the way.

## How It Was Built

### The Stack

Emoji Nook is a **Tauri v2** app — Rust on the backend, React 19 on the frontend, with WebKitGTK rendering the UI. The full tech stack:

| Layer | Technology | Why |
|-------|-----------|-----|
| Shell | Tauri v2 | Native window management, system tray, IPC — all without Electron's overhead |
| Frontend | React 19 + TypeScript | Modern component model, hooks for state |
| Emoji | Frimousse v0.3 | Headless React emoji picker — full styling freedom, ~12 kB emoji data on demand |
| Portal | ashpd (via custom plugin) | D-Bus bridge to `xdg-desktop-portal` for theme, shortcuts, and input |
| Clipboard | arboard | Cross-platform clipboard with Wayland serve-thread support |
| Settings | tauri-plugin-store | Persistent JSON key-value store for user preferences |
| Build | pnpm workspaces + Cargo workspace | Monorepo with the app and custom plugin side by side |

The project is structured as a monorepo: the emoji picker app lives in `apps/emoji-picker/`, and the custom portal plugin lives in `plugins/xdg-portal/`. Both share a Cargo workspace so the Rust side compiles together, and pnpm manages the frontend and plugin guest bindings.

### The Custom Plugin

The biggest piece of original work is `tauri-plugin-xdg-portal` — a Tauri v2 plugin that bridges the app with Linux's `xdg-desktop-portal` D-Bus interfaces through the `ashpd` crate.

This plugin handles:

- **Theme detection** — queries the portal for colour scheme (`prefer-dark`, `prefer-light`, `no-preference`), accent colour (as sRGB floats), and high contrast mode
- **Desktop environment identification** — reads `XDG_CURRENT_DESKTOP` to select the right token set (Adwaita vs Breeze)
- **Global shortcuts on Wayland** — registers shortcuts through the GlobalShortcuts portal, which is the only secure way to listen for key combinations under Wayland's isolation model

The plugin follows Tauri v2's permission system with auto-generated capability manifests, so the app must explicitly grant itself access to each command — no ambient authority.

<!-- TODO: Add screenshot of the picker with GNOME Adwaita dark theme applied -->

## The Philosophy

### Blend In, Don't Stand Out

Most cross-platform apps look the same everywhere. That's a feature for some tools, but for something you invoke dozens of times a day, visual friction matters. If the picker looks like it belongs on macOS while you're running KDE Plasma, it breaks the flow.

Emoji Nook reads your actual desktop theme from the portal and injects matching CSS custom properties: background colours, surface colours, accent colour, border radii, shadows, and font family. On GNOME you get Cantarell with 12px rounded corners and soft shadows. On KDE you get Noto Sans with 6px radii and crisper edges. The picker doesn't just respect dark mode — it respects *your* dark mode.

When the portal isn't available (maybe you're on a minimal WM without a portal daemon), it falls back to the browser's `prefers-color-scheme` media query. Graceful degradation, not a crash.

### The Clipboard Shuffle

Injecting text into another application on Linux is harder than it sounds. On X11, `xdotool` can type characters directly. On Wayland, the security model prevents apps from injecting input into each other — that's by design, and it's a good thing.

Emoji Nook's approach is what we call the **clipboard shuffle**:

1. Save whatever's currently on the clipboard
2. Write the emoji to the clipboard and keep the clipboard instance alive (so arboard's serve thread can answer paste requests)
3. Wait for focus to settle on the target app
4. Simulate `Ctrl+V` using whichever tool is available — `ydotool` (preferred, works everywhere via `/dev/uinput`), `wtype` (Wayland-native), or `xdotool` (X11 fallback)
5. Wait for the paste to complete
6. Restore the original clipboard contents

The key insight is keeping the `Clipboard` instance alive through the paste. On Wayland, the clipboard is selection-based — the serving app must be alive and ready to hand over the data when the receiving app asks for it. Dropping the instance too early means the paste fails silently.

If the original clipboard had non-text content (an image, a file), we leave it alone rather than destroying it with a text restore. Small detail, but it matters when someone had a screenshot queued up.

<!-- TODO: Add the emoji selection pipeline diagram (docs/images/emoji_selection_pipeline.svg) -->

### Display Server Routing

Linux doesn't have one input system — it has two, and the app needs to handle both. On startup, the Rust backend checks for `WAYLAND_DISPLAY`:

- **Wayland present** → global shortcuts route through the xdg-portal plugin's GlobalShortcuts session; emoji injection uses the clipboard shuffle with `ydotool`/`wtype`
- **X11** → global shortcuts use `tauri-plugin-global-shortcut`; injection uses `xdotool`

This routing is explicit and happens once at startup. No runtime guessing, no fallback chains that mask failures.

<!-- TODO: Add the theme detection flow diagram (docs/images/theme_detection_flow.svg) -->

## How It Works (User's Perspective)

1. **Install and launch** — Emoji Nook starts in the background. A small icon appears in your system tray.
2. **Press the shortcut** — `Alt+Shift+E` by default. A compact picker fades in, centred on screen, always on top.
3. **Search or browse** — the search bar is autofocused. Type to filter, or click a category tab to jump to smileys, animals, food, flags, etc.
4. **Pick a skin tone** — optional skin tone selector at the top of the picker. Your choice persists across sessions.
5. **Click or press Enter** — the picker vanishes, focus returns to your previous app, and the emoji appears in your text field.
6. **Keep going** — if you disable "close on select" in settings, the picker sticks around for rapid-fire emoji entry.

The settings panel (accessible via the gear icon) lets you reconfigure the shortcut, choose a default skin tone, toggle close-on-select, and enable autostart. On X11, shortcut changes take effect immediately. On Wayland, a restart is needed because portal sessions can't be dynamically re-bound — the settings panel tells you this.

<!-- TODO: Add screenshot of the settings panel -->

## Architecture at a Glance

The app has three layers:

```
┌─────────────────────────────────────────┐
│  React 19 Frontend (WebKitGTK)          │
│  Frimousse picker + CSS token system    │
├─────────────────────────────────────────┤
│  Tauri v2 IPC Bridge                    │
│  Commands: insert_emoji, show/hide,     │
│  update_shortcut                        │
├─────────────────────────────────────────┤
│  Rust Backend                           │
│  System tray, clipboard shuffle,        │
│  display server routing                 │
├─────────────────────────────────────────┤
│  tauri-plugin-xdg-portal               │
│  ashpd → D-Bus → xdg-desktop-portal    │
│  Theme, shortcuts, (future: injection)  │
└─────────────────────────────────────────┘
```

The frontend never touches the clipboard or the display server directly. It sends an emoji string over IPC and trusts the backend to handle the rest. This separation means the security-sensitive operations — clipboard access, input simulation, portal sessions — live entirely in Rust where they can be audited and sandboxed.

<!-- TODO: Add architecture overview diagram or link to docs/architecture.md -->

## Building It With AI

Emoji Nook was built collaboratively with Claude, Anthropic's AI assistant. The development process was conversational — describing what we wanted, iterating on implementations, debugging Tauri v2's plugin permission system by cross-referencing a working reference app, reading Frimousse's minified source to understand its focus model, and crafting animated SVG diagrams for the documentation.

Some highlights from the collaboration:

- **Debugging the portal plugin** — the Tauri v2 permission system uses a specific TOML format (`[default]` section, not `[[permission]]` blocks) and requires `cargo build` (not `cargo check`) to populate the capability manifest. We figured this out by comparing against a working plugin in another project.
- **Fixing category scroll** — `offsetTop`/`offsetParent` was unreliable inside Frimousse's DOM nesting. Switching to `getBoundingClientRect()` solved it cleanly.
- **Focus outline bug** — adding `tabIndex={0}` to the viewport for keyboard navigation caused WebKitGTK to render a thick blue focus rectangle behind the entire emoji grid. Since Frimousse already highlights the active emoji, we suppressed the viewport outline.
- **Code review** — Codex caught two real issues: the `IntersectionObserver` only ran once on mount (missing headers rendered after Frimousse's async load), and the theme hook forced light mode when the portal returned `"no-preference"`. Both were valid and got fixed.

The whole process — from scaffold to working picker with theme detection, shortcuts, injection, settings, CI, release automation, and documentation — happened across a handful of conversations. AI didn't replace the design decisions, but it made the implementation dramatically faster.

## What's Next

Emoji Nook is functional but still early. The roadmap includes:

- **First tagged release** — Linux x64 and arm64 builds via GitHub Releases
- **RemoteDesktop portal injection** — using the portal's input simulation instead of external tools like `ydotool`
- **Live theme updates** — re-reading the portal when the user changes their system theme without restarting the picker
- **Animation and polish** — subtle show/hide transitions, smoother scroll behaviour
- **Broader testing** — Sway, Hyprland, and other Wayland compositors beyond GNOME and KDE

## Try It

Emoji Nook is open source under a dual Apache 2.0 / MIT licence.

**Repository:** [github.com/liminal-hq/emoji-nook](https://github.com/liminal-hq/emoji-nook)

```bash
git clone https://github.com/liminal-hq/emoji-nook.git
cd emoji-nook
pnpm install
pnpm tauri:dev
```

If you're on Linux and tired of hunting for emoji, give it a spin. Contributions, bug reports, and feedback are welcome.

---

*(c) 2026 Liminal HQ, Scott Morris*
