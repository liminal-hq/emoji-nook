# The Story of Emoji Nook (Told in ASCII)

**TL;DR** — A short, illustrated tale of why Emoji Nook exists, how it summons itself, dresses to match your desktop, and pulls off a clipboard heist to land an emoji in whatever app you were just using. Same project, lighter read — drawn entirely in monospace.

---

```
        ┌─────────────────────────────────────────────┐
        │   ███████╗███╗   ███╗ ██████╗      ██╗██╗     │
        │   ██╔════╝████╗ ████║██╔═══██╗     ██║██║     │
        │   █████╗  ██╔████╔██║██║   ██║     ██║██║     │
        │   ██╔══╝  ██║╚██╔╝██║██║   ██║██   ██║██║     │
        │   ███████╗██║ ╚═╝ ██║╚██████╔╝╚█████╔╝██║     │
        │   ╚══════╝╚═╝     ╚═╝ ╚═════╝  ╚════╝ ╚═╝     │
        │              N  O  O  K                       │
        └─────────────────────────────────────────────┘
```

## Chapter I — The Problem

```
   You, mid-sentence, on Linux:

   "great work everyone, ship it ___"
                                  │
                                  ▼
                          need: a rocket
                                  │
                                  ▼
        ┌──────────────────────────────────────┐
        │  GNOME's picker?   half the emoji.    │
        │  Copy from a site? lose your place.   │
        │  Memorise codes?   U+1F680 ... really?│
        └──────────────────────────────────────┘
```

On macOS you tap a key and a picker blooms. On Linux, emoji entry is a patchwork — buried shortcuts, browser copy-paste, or memorising codepoints. Emoji Nook exists to fix exactly this: **a little picker that lives in the corner of your system and shows up the instant you call it.**

## Chapter II — The Summoning

```
        Alt + Shift + E
        ════╤══════════
            │  global shortcut
            ▼
     ┌─────────────┐         ┌────────────────────────┐
     │  Wayland?    │──yes──▶ │ xdg-desktop-portal      │
     │ (WAYLAND_    │         │ GlobalShortcuts (ashpd) │
     │  DISPLAY?)   │──no───▶ │ tauri-plugin-global-    │
     └─────────────┘         │ shortcut (X11)          │
                             └──────────┬─────────────┘
                                        ▼
                          ╭───────────────────────╮
                          │    the picker wakes     │
                          ╰───────────────────────╯
```

The hard part isn't drawing emoji — it's **being there when summoned, on any desktop**. Linux has two display worlds, Wayland and X11, and Emoji Nook learns which one it's in at launch, then routes every shortcut and injection down the right path.

## Chapter III — The Window That Never Dies

```
     [*]──▶ Hidden ──shortcut──▶ Visible ──Esc / blur──▶ Hidden
              ▲                     │  │
              │                     │  └──gear──▶ Settings
              └──emoji selected─────┘             │
                 (if closeOnSelect)    ◀──save────┘

     Created ONCE. Never destroyed. Only shown & hidden.
     Frameless · transparent · always-on-top · 370 × 380
```

Re-creating a window is slow, so Emoji Nook builds its overlay a single time and just toggles its visibility. It floats frameless and transparent over your desktop like it belongs there — because, dressed in your theme, it does.

## Chapter IV — The Chameleon

```
   xdg-desktop-portal  ──▶  "colour scheme? accent? desktop?"
                                    │
              ┌─────────────────────┴────────────────────┐
              ▼                                           ▼
        ╔═══════════╗                              ╔═══════════╗
        ║  ADWAITA  ║  GNOME·Cinnamon·MATE·XFCE    ║  BREEZE   ║  KDE Plasma
        ║ Cantarell ║                              ║ Noto Sans ║
        ╚═════╤═════╝                              ╚═════╤═════╝
              └───────────────┬──────────────────────────┘
                              ▼
                  --bg-primary  --accent  --font-family
                  --radius-md   color-scheme: dark/light
                              ▼
                   the picker now matches YOUR desktop
```

Every time it appears, Emoji Nook re-asks the portal what your desktop looks like and re-paints itself: GNOME's blue Adwaita, KDE's Breeze, your accent colour, even the system font. It's a guest that dresses to match the house — and when no portal is available, it falls back gracefully to the browser's `prefers-color-scheme`.

## Chapter V — The Heist (a.k.a. The Clipboard Shuffle)

```
   You pick:  [rocket]
        │
        ▼  invoke("insert_emoji")
   ┌────────────────────────────────────────────────┐
   │ 1. window.hide()        <- focus returns to you │
   │ 2. save current clipboard                       │
   │ 3. write the emoji to the clipboard             │
   │ 4. sleep 100ms          <- let focus settle     │
   │ 5. press Ctrl+V    ydotool > wtype > xdotool     │
   │ 6. sleep 200ms          <- let paste land        │
   │ 7. restore clipboard                            │
   └────────────────────────────────────────────────┘
        │
        ▼
   "great work everyone, ship it [rocket]"
```

This is the cleverest trick in the whole app. There's no universal "type this character" API on Linux — and Wayland deliberately stops apps from injecting input into one another. So Emoji Nook **borrows your clipboard**, pastes the emoji with a simulated `Ctrl+V`, then quietly puts your clipboard back the way it found it. The key subtlety: it keeps the clipboard instance alive through the paste, because on Wayland the writing app must stay around to serve the data when the target asks for it. If your clipboard held an image or a file, it leaves it untouched rather than clobbering it with a text restore.

## Chapter VI — How It's Built

```
   ┌─ emoji-nook/ ──────────────────────────────────────────┐
   │                                                         │
   │   apps/emoji-picker/                                    │
   │     ├── src/            React 19 + TS  (Frimousse)      │
   │     │     App.tsx · useTheme · useSettings · App.css    │
   │     └── src-tauri/      Rust / Tauri v2                 │
   │           lib.rs (tray, shortcuts, commands)            │
   │           injection.rs (the clipboard heist)            │
   │                                                         │
   │   plugins/xdg-portal/   tauri-plugin-xdg-portal         │
   │     └── ashpd > D-Bus > xdg-desktop-portal              │
   │                                                         │
   │            pnpm + Cargo workspace monorepo              │
   └─────────────────────────────────────────────────────────┘
```

A React frontend rides inside a Tauri webview; a Rust backend handles the OS-level magic; and a custom plugin speaks D-Bus to the desktop portal. The frontend never touches the clipboard or the display server directly — it sends an emoji string over IPC and trusts the backend to do the rest. Three layers, one cosy nook.

## Chapter VII — Where It Stands Today

```
   [x] picker UI            [x] theme detection
   [x] global shortcuts     [x] emoji injection
   [x] settings + autostart [x] system tray
   [x] CI + release automation checked in
   ───────────────────────────────────────
   >> next milestone: the first live tagged release

   known gremlins:
   • window dragging fights WebKitGTK  (#5)
   • Wayland shortcut changes need a restart
   • live theme changes aren't real-time (re-fetched on show)
```

---

```
        Emoji Nook  —  a little picker that
        blends into your Linux desktop,
        waits quietly in the tray,
        and shows up the moment you need it.
```

That's the tale: a background app that solves one small, persistent Linux annoyance with a clipboard sleight-of-hand and a wardrobe full of desktop themes. For the deeper technical write-up, see [Introducing Emoji Nook](blog-introducing-emoji-nook.md) and the [architecture overview](architecture.md).

---

_(c) 2026 Liminal HQ, Scott Morris_
