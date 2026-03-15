# Desktop Integration Implementation Plan

This plan covers the remaining work to turn the emoji picker from a standalone test window into a production-ready system-wide utility. It picks up where the [emoji picker UI plan](emoji-picker-ui.md) left off and implements the behavioural requirements from `SPEC.md`.

## Goal

Make Emoji Nook a background process that appears on a global shortcut, injects the selected emoji into the previously focused application, and vanishes — behaving like a native OS utility rather than an application window.

## Prerequisites

The emoji picker UI plan must be complete (Gates 1 and 2 passed). The following are in place:

- Frimousse emoji picker with search, categories, keyboard navigation, skin tones
- Native theme detection and Adwaita/Breeze styling via xdg-portal
- `insert_emoji` IPC command
- xdg-portal plugin with `ashpd` integration and placeholder shortcut/remote-desktop commands

## Design Decisions

### Display server strategy

Linux has two display server protocols with fundamentally different security models:

| Capability       | X11                                               | Wayland                                                                |
| ---------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| Global shortcuts | `tauri-plugin-global-shortcut` (works directly)   | `xdg-desktop-portal` GlobalShortcuts (requires user permission prompt) |
| Input injection  | `ydotool` / `xdotool` via `std::process::Command` | `ydotool` / `wtype` via `std::process::Command`                        |
| Clipboard        | `arboard` (handles both transparently)            | `arboard` (handles both transparently)                                 |

Detection: check `WAYLAND_DISPLAY` environment variable at startup. Route all shortcut and injection calls through the appropriate backend.

> **Deviation from original plan:** `enigo` was dropped in favour of shelling out to `ydotool`, `wtype`, and `xdotool` for keystroke simulation. `ydotool` is the primary tool — it works at the kernel `/dev/uinput` level, bypassing both X11 and Wayland display server restrictions. `wtype` and `xdotool` serve as fallbacks. RemoteDesktop portal injection was deferred.

### Window lifecycle

The picker window has three states:

1. **Hidden** — default on startup and after selection. Window is invisible, not destroyed.
2. **Visible** — triggered by global shortcut. Window appears centred, frameless, always-on-top, with search autofocused.
3. **Dismissed** — triggered by Esc, clicking outside, or emoji selection. Window hides, focus returns to previous app.

The window is never destroyed during the app lifecycle; it is shown and hidden to avoid re-creation cost.

### Draggable window

The picker uses `data-tauri-drag-region` on the shell container, making the entire window draggable. Interactive elements (search input, buttons, emoji grid, viewport) opt out via `-webkit-app-region: no-drag` in CSS. This approach (from the Threshold reference app) is simpler than applying `data-tauri-drag-region` to individual elements.

### Emoji injection strategy

Primary path (both X11 and Wayland): clipboard shuffle.

1. Save current clipboard contents
2. Write selected emoji to clipboard (arboard serve thread stays alive)
3. Hide picker window (OS returns focus to previous app)
4. Wait ~100ms for focus to settle
5. Simulate Ctrl+V via `ydotool` (primary) → `wtype` (Wayland fallback) → `xdotool` (X11 fallback)
6. Wait ~200ms for paste to complete
7. Drop the clipboard instance (arboard serve thread stops)
8. Restore original clipboard contents via clipboard manager handover (500ms timeout)

> **Deviation from original plan:** RemoteDesktop portal injection was deferred. `enigo` was replaced by shelling out to `ydotool`, `wtype`, and `xdotool`. `ydotool` (kernel `/dev/uinput`) is the primary tool — it bypasses display server restrictions entirely, working on X11, Wayland, GNOME, KDE, Sway, etc. The clipboard is kept alive through the paste rather than using `wait_until` for clipboard manager handover on the set step, eliminating the ~2 second timeout delay.

### Settings persistence

Use `tauri-plugin-store` for a local JSON config. Initial settings:

- `shortcut`: the global shortcut binding (default: `Alt+Shift+E`)
- `skinTone`: preferred skin tone (persisted across sessions)
- `closeOnSelect`: whether to hide after selection (default: `true`)

## Scope

### In scope

- Window overlay configuration (frameless, transparent, always-on-top, centred)
- Global shortcut registration (Wayland via xdg-portal, X11 via tauri-plugin-global-shortcut)
- Show/hide window lifecycle with focus management
- Escape to dismiss
- Click-outside to dismiss
- Emoji injection into previously focused app (clipboard shuffle)
- Draggable window via `data-tauri-drag-region`
- System tray with context menu (Show Picker, Quit)
- Settings UI (shortcut capture, skin tone preference, close-on-select toggle)
- Settings persistence via tauri-plugin-store
- Display server detection and dynamic routing

### Out of scope

- macOS / Windows support (Linux-only for now)
- Flatpak/Snap sandboxing
- Custom emoji / favourites / recently used
- Multiple monitor positioning
- Auto-update

## Implementation Phases

### Gate 1: It pops up (Phases 1–3)

Transform the test window into a shortcut-activated overlay.

#### Phase 1: Window overlay configuration

- [x] Update `tauri.conf.json`:
  - `visible: false` (hidden on startup)
  - `decorations: false` (frameless)
  - `transparent: true`
  - `alwaysOnTop: true`
  - `center: true`
  - `resizable: false`
  - `skipTaskbar: true`
  - Set width/height to compact picker dimensions (370×380)
- [x] Update CSS to handle transparency (body background transparent, picker shell provides its own background and shadow)
- [x] Picker shell fills the overlay window with margin for rounded-corner float effect
- [x] Verify the picker renders correctly as a frameless overlay

#### Phase 2: Show/hide lifecycle

- [x] Add `show_picker` Tauri command:
  - Call `window.center()`, `window.show()`, `window.set_focus()`
  - Emit a `picker-shown` event so the frontend can autofocus search
- [x] Add `hide_picker` Tauri command:
  - Call `window.hide()`
- [x] Wire Esc key in frontend to call `hide_picker`
- [x] Wire click-outside detection (`onFocusChanged` blur event) to hide
- [x] Frontend: on `picker-shown` event, focus search input
- [x] `insert_emoji` hides the picker after selection
- [ ] Verify show → interact → hide → show cycle works without state leaks

#### Phase 3: Global shortcut registration

- [x] Add display server detection in Rust (`WAYLAND_DISPLAY` check)
- [x] **Wayland path:** implement real `GlobalShortcuts` portal flow in xdg-portal plugin:
  - Create a session via `ashpd::desktop::global_shortcuts::GlobalShortcuts`
  - Bind the configured shortcut
  - Listen for activation signals on a background task
  - On activation, toggle picker visibility
- [x] **X11 path:** integrate `tauri-plugin-global-shortcut`:
  - Register the configured shortcut on startup
  - On activation, toggle picker visibility
- [x] Add `xdg-portal:allow-bind-global-shortcut` and `xdg-portal:allow-unbind-global-shortcut` to the app's default capability
- [x] Default shortcut: `Alt+Shift+E`
- [x] Shortcut toggles picker visibility (press to show, press again or Esc to hide)

**Gate 1 result: shortcut opens picker, Esc/click-outside closes it, focus returns to previous app.**

### Gate 2: It injects (Phases 4–5)

Make emoji selection actually type the emoji into the target app.

#### Phase 4: Emoji injection

- [x] Add `arboard` to `apps/emoji-picker/src-tauri/Cargo.toml`
- [x] Implement clipboard shuffle in `injection.rs`:
  - Save clipboard → write emoji → hide window → delay → Ctrl+V → delay → restore clipboard
- [x] Wayland paste simulation via `wtype`
- [x] X11 paste simulation via `xdotool`
- [x] Update `insert_emoji` command to:
  1. Hide the picker window
  2. Spawn a background thread for the clipboard shuffle
  3. Inject the emoji via the appropriate method
- [x] Handle edge cases:
  - Clipboard restore failure (log warning, don't crash)

> **Deviation:** `enigo` was not added. `xdotool` (X11) and `wtype` (Wayland) are used directly via `std::process::Command` instead. RemoteDesktop portal injection was deferred.

#### Phase 5: System tray

- [x] Create system tray icon using `TrayIconBuilder` with default app icon
- [x] Context menu items:
  - **Show Picker** — opens the overlay
  - **Quit** — exits the application
- [x] Tray icon tooltip: "Emoji Nook"
- [x] App does not appear in the taskbar (`skipTaskbar: true` in config)

> **Deviation:** Settings menu item deferred to Phase 6 when the settings UI is built.

**Gate 2 result: selecting an emoji types it into the previously focused app. Tray icon provides basic controls.**

### Gate 3: It remembers (Phases 6–7)

Add settings and polish.

#### Phase 6: Settings UI and persistence

- [x] Add `tauri-plugin-store` to dependencies and capabilities
- [x] Create settings store with defaults:
  ```json
  {
  	"shortcut": "Alt+Shift+E",
  	"skinTone": "none",
  	"closeOnSelect": true,
  	"autostart": false
  }
  ```
- [x] Build settings panel component:
  - Shortcut capture input (records key combination)
  - Skin tone preference dropdown
  - Close-on-select toggle
  - Autostart toggle
  - Save / Cancel buttons
- [x] Add gear icon to picker header that navigates to settings panel
- [x] View toggle between picker and settings (Esc returns to picker)
- [x] On save:
  - Persist to store
  - Re-register global shortcut with new binding (X11; Wayland requires restart)
  - Apply skin tone preference
  - Toggle autostart via `tauri-plugin-autostart`
- [x] On startup:
  - Read store values
  - Apply stored skin tone

> **Deviation:** View transition is a simple swap rather than a flip/slide animation — keeps the implementation lean. Autostart was added as a first-class setting rather than deferred. Shortcut is registered with the hardcoded default on startup rather than read from the store — dynamic Wayland shortcut re-registration requires a new portal session, so changes require restart on Wayland.

#### Phase 7: Polish and edge cases

- [x] Theme refresh on picker show:
  - Re-fetches theme info from the portal each time the picker is shown
  - Catches theme changes between hide/show cycles
- [x] Esc handling: Esc closes settings view first, then hides picker
- [x] Close-on-select: respects the setting — picker stays open when disabled
- [ ] Live theme change listener (deferred):
  - Subscribe to `org.freedesktop.portal.Settings` change signals via `ashpd`
  - Emit Tauri events to frontend
  - Would provide instant theme updates without needing to re-show the picker
- [ ] Window positioning: centre on the active monitor (not just primary)
- [ ] Focus management hardening for tiling WMs (Sway, i3)
- [ ] Performance: measure and optimise show latency (target <100ms from shortcut to visible)

> **Deviation:** Live theme listener via portal signals was deferred — the re-fetch-on-show approach covers the common case (theme changed while picker is hidden). Active monitor centring and tiling WM hardening remain as follow-on work.

**Gate 3 result: settings persist across restarts, shortcut is customisable, autostart is toggleable, theme refreshes on show.**

## Dependencies Added

| Crate / Package                | Purpose                           | Phase |
| ------------------------------ | --------------------------------- | ----- |
| `tauri-plugin-global-shortcut` | X11 global shortcuts              | 3     |
| `arboard`                      | Clipboard read/write for shuffle  | 4     |
| `futures-util`                 | Stream handling for portal async  | 3     |
| `tokio`                        | Async runtime, `select!` macro    | 3     |
| `tauri-plugin-store`           | Persistent JSON settings          | 6     |
| `tauri-plugin-autostart`       | XDG autostart desktop file toggle | 6     |

Dependencies **not** added (deferred or replaced):

| Crate   | Original Purpose     | Reason                                      |
| ------- | -------------------- | ------------------------------------------- |
| `enigo` | Keystroke simulation | Replaced by `xdotool`/`wtype` via `Command` |

System runtime dependencies:

- `ydotool` (kernel uinput Ctrl+V simulation — primary, works everywhere)
- `wtype` (Wayland Ctrl+V fallback for non-GNOME compositors)
- `xdotool` (X11/XWayland Ctrl+V fallback)

## Risks and Mitigations

### Focus race conditions

Hiding the window and injecting input must be sequenced carefully. If the injection fires before focus returns to the target app, the emoji is lost. Mitigation: configurable delay (default 80ms), with compositor-specific tuning if needed.

### Wayland portal permissions

`GlobalShortcuts` requires user permission via the desktop portal. The user may deny. Mitigation: detect denial and log an error explaining the shortcut won't work. The tray icon provides a fallback for showing the picker.

### Tiling window managers

On i3, Sway, Hyprland etc., hiding a window may not return focus to the previous app — it may focus the next window in the layout stack. Mitigation: before showing the picker, record the focused window ID (if available via portal or X11 APIs) and attempt to re-focus it after hiding.

### ashpd API stability

`ashpd` v0.9.x has a Rust future-compatibility warning. Monitor for updates. The `GlobalShortcuts` portal API is stable in `xdg-desktop-portal` 1.16+.

## File Map

| File                                                 | Purpose                                     |
| ---------------------------------------------------- | ------------------------------------------- |
| `apps/emoji-picker/src-tauri/src/lib.rs`             | App setup, tray, shortcut routing           |
| `apps/emoji-picker/src-tauri/src/injection.rs`       | Clipboard shuffle and injection logic       |
| `apps/emoji-picker/src/hooks/useSettings.ts`         | Settings persistence via tauri-plugin-store |
| `apps/emoji-picker/src/components/SettingsPanel.tsx` | Settings UI panel                           |
| `plugins/xdg-portal/src/global_shortcuts.rs`         | Real GlobalShortcuts portal implementation  |
| `plugins/xdg-portal/src/remote_desktop.rs`           | (stub) RemoteDesktop portal — future use    |
| `docs/linux-setup.md`                                | Linux setup guide for system dependencies   |
| `scripts/setup-linux.sh`                             | Auto-install script for Linux dependencies  |

## Follow-On (outside this plan)

- macOS and Windows support
- Flatpak packaging with portal permissions manifest
- Custom emoji and frequently used tracking
- Multi-monitor awareness
- Auto-update via tauri-plugin-updater
- RemoteDesktop portal injection as an optimisation over clipboard shuffle
