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

## Architecture

### The Layer Cake

Emoji Nook is split into four distinct layers, each with a clear responsibility boundary:

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

**The frontend** is a single-page React 19 app rendered inside a Tauri webview (WebKitGTK on Linux). It wraps Frimousse's headless emoji picker with custom components: a search bar, skin tone selector, category navigation bar, emoji grid, and a settings panel. Two custom hooks — `useTheme` and `useSettings` — manage the bridge between the frontend and the Rust backend via Tauri's IPC.

**The IPC layer** exposes four commands: `insert_emoji` (sends the selected emoji to the backend for injection), `show_picker` / `hide_picker` (window lifecycle), and `update_shortcut` (re-registers the global hotkey). The frontend also listens for a `picker-shown` event emitted by the backend so it can reset its state — clear the search, scroll to top, and autofocus the input.

**The Rust backend** (`lib.rs`) is the orchestrator. On startup it reads the saved shortcut from `tauri-plugin-store`, detects the display server, registers the global shortcut through the appropriate path (portal or X11 plugin), and sets up the system tray. When an emoji is selected, the backend hides the window and spawns a background thread for the clipboard shuffle — keeping the IPC handler responsive while the injection sleeps through its timing windows.

**The xdg-portal plugin** is the Linux integration layer. It's a full Tauri v2 plugin with its own Cargo crate, TypeScript guest bindings, and auto-generated permission manifests. It talks to `xdg-desktop-portal` over D-Bus using `ashpd`, exposing commands like `get_theme_info` and `bind_global_shortcut` to the rest of the app. The plugin is intentionally general — it could be extracted and used by other Tauri apps that need portal access.

### The Window

The picker window is configured as a frameless, transparent, always-on-top overlay:

| Property | Value | Purpose |
|----------|-------|---------|
| `decorations` | `false` | No title bar or window controls |
| `transparent` | `true` | CSS provides the background — transparency enables rounded corners floating over the desktop |
| `alwaysOnTop` | `true` | Stays above the target app |
| `skipTaskbar` | `true` | Background process, tray-only — no taskbar clutter |
| `visible` | `false` | Hidden on startup, shown on shortcut |
| Size | 370 × 380 | Compact enough to not obscure the target app |

The window is created once at startup and never destroyed — only shown and hidden. This avoids re-creation cost and means the picker is ready instantly when the shortcut fires. The CSS uses `-webkit-app-region: drag` on the header and footer so the user can reposition the overlay, with interactive elements opting out via `no-drag`.

<!-- TODO: Add architecture overview diagram or link to docs/architecture.md -->

## Integrating with Wayland and X11

Linux doesn't have one input system — it has two, and they work in fundamentally different ways. Getting an emoji picker to work across both required us to build two complete integration paths behind a single runtime switch.

### The Core Challenge

On **X11**, the legacy display server, apps have broad access. Any application can listen for global key events, inject keystrokes into other windows, and read the clipboard freely. This makes building a system-wide emoji picker straightforward — tools like `xdotool` can simulate `Ctrl+V` in any window, and `tauri-plugin-global-shortcut` can grab hotkeys regardless of which window has focus.

**Wayland** is deliberately different. Its security model isolates applications from each other: an app cannot listen to inputs directed at other windows (preventing keyloggers) and cannot inject inputs into them (preventing malicious control). These are good restrictions, but they mean every capability an emoji picker needs — global shortcuts, keystroke injection, even clipboard serving — requires explicit cooperation from the compositor through portal interfaces.

### Detection

The routing decision is simple and happens once at app startup:

```rust
fn is_wayland() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
}
```

If `WAYLAND_DISPLAY` is set, we're on Wayland. Otherwise, we assume X11. No complex capability probing, no fallback chains — just a binary decision that gates the entire backend path.

### Global Shortcuts: Two Completely Different Mechanisms

**On X11**, we use `tauri-plugin-global-shortcut`, which registers hotkeys via the X11 protocol. It's reliable and immediate — the shortcut fires a callback, and we show or hide the window:

```rust
app.global_shortcut().on_shortcut("Alt+Shift+E", move |_app, _shortcut, event| {
    if event.state == ShortcutState::Pressed {
        // Toggle picker visibility
    }
});
```

Shortcut changes take effect immediately by calling `unregister_all()` and re-registering.

**On Wayland**, global shortcuts go through `xdg-desktop-portal`'s GlobalShortcuts interface. Our custom plugin creates a D-Bus session via `ashpd`, binds the shortcut, and listens for activation signals on a long-lived async stream:

```rust
let portal = GlobalShortcuts::new().await?;
let session = portal.create_session().await?;
portal.bind_shortcuts(&session, &[shortcut], &WindowIdentifier::default()).await?;

let activated_stream = portal.receive_activated().await?;
// Listen for activations in a spawned task...
```

The session handle is intentionally leaked (`std::mem::forget`) to keep it alive for the lifetime of the process — dropping it would tear down the portal session and the shortcut would stop working. This also means Wayland shortcut changes require an app restart, because a portal session can't be dynamically re-bound. The settings panel communicates this to the user.

There's also retry logic: the portal may reject `bind_shortcuts` if the app isn't fully initialised yet or if a previous session is still active. We retry once after a one-second delay before giving up.

### Emoji Injection: The Clipboard Shuffle in Detail

Once the user picks an emoji, the injection path is the same on both display servers — but the paste simulation tool differs.

The clipboard shuffle runs on a background thread (to avoid blocking the IPC handler) and follows a precise sequence with carefully tuned timing:

```
1. Save clipboard     → arboard get_text()
2. Write emoji        → arboard set_text(emoji)  [serve thread starts]
3. Sleep 100ms        → focus settles on target app
4. Simulate Ctrl+V    → ydotool / wtype / xdotool
5. Sleep 200ms        → paste completes
6. Drop clipboard     → arboard serve thread stops
7. Restore or clear   → new Clipboard instance
```

The paste simulation cascades through three tools in priority order:

1. **`ydotool`** — talks directly to the kernel's `/dev/uinput` interface. Works on X11, Wayland, GNOME, KDE, Sway, and everything else. It's the most reliable option but requires the `ydotoold` daemon running and the user in the `input` group.

2. **`wtype`** — native Wayland protocol for keystroke simulation. Works on compositors that support `wlr-virtual-keyboard-v1` (Sway, Hyprland) but not on GNOME's Mutter.

3. **`xdotool`** — X11 protocol. Works on X11 and XWayland apps but can't reach native Wayland windows.

If all three fail, the emoji is still on the clipboard — the user can paste manually. The app logs which tool succeeded or failed for debugging.

### Clipboard Ownership on Wayland

The most subtle part of the injection is clipboard ownership. On Wayland, the clipboard follows a "last writer serves" model — the application that wrote to the clipboard must remain alive and serve data requests when another app asks to paste. This is fundamentally different from X11, where clipboard data is typically stored in a shared buffer.

This is why we keep the `arboard::Clipboard` instance alive through stages 2–5. When the target app receives the `Ctrl+V` and asks the compositor "what's on the clipboard?", the compositor forwards that request to our arboard serve thread, which responds with the emoji. Only after the paste completes (the 200ms sleep in stage 5) do we drop the instance.

If the clipboard originally held non-text content (an image, a file path), we can't snapshot it with the text API, so we skip the restore step entirely rather than destroying the user's clipboard contents.

### The Portal Plugin: A Reusable Bridge

`tauri-plugin-xdg-portal` isn't just glue code — it's a proper Tauri v2 plugin with:

- **Rust source** — `commands.rs` (IPC handlers), `linux.rs` (ashpd D-Bus queries), `global_shortcuts.rs` (portal session management), `models.rs` (serialisable types like `ThemeInfo`, `ColourScheme`, `AccentColour`)
- **TypeScript guest bindings** — auto-generated API so the frontend can call `portal.getThemeInfo()` directly
- **Permission manifests** — Tauri v2's capability system requires explicit grants for each command. The plugin's `default.toml` declares `allow-check-availability` and `allow-get-theme-info`; the app's capability file opts in.
- **A stub for RemoteDesktop** — the portal also offers input injection via `org.freedesktop.portal.RemoteDesktop`, which would let us inject keystrokes without external tools. This is deferred but architecturally planned.

The plugin queries three portal settings over D-Bus:

| Portal Setting | What It Returns | How We Use It |
|---------------|----------------|---------------|
| `color_scheme()` | `prefer-dark`, `prefer-light`, or `no-preference` | Selects dark/light token set. Falls back to `matchMedia` on `no-preference` |
| `accent_color()` | sRGB floats (r, g, b) | Converted to hex and injected as `--accent` CSS property |
| `contrast()` | Normal or high | Reserved for future high-contrast token support |

Desktop environment detection (`XDG_CURRENT_DESKTOP`) selects between Adwaita tokens (GNOME, Cinnamon, MATE, XFCE) and Breeze tokens (KDE). Theme info is re-fetched every time the picker is shown, so if the user switches from light to dark mode while the picker is hidden, it'll pick up the change on the next invocation.

<!-- TODO: Add the display server routing diagram -->

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
