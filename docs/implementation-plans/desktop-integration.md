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

| Capability | X11 | Wayland |
|-----------|-----|---------|
| Global shortcuts | `tauri-plugin-global-shortcut` (works directly) | `xdg-desktop-portal` GlobalShortcuts (requires user permission prompt) |
| Input injection | `enigo` via `xdotool` | `xdg-desktop-portal` RemoteDesktop (requires session) |
| Clipboard | `arboard` via `xclip`/`xsel` | `arboard` via `wl-clipboard` |

Detection: check `WAYLAND_DISPLAY` environment variable at startup. Route all shortcut and injection calls through the appropriate backend.

### Window lifecycle

The picker window has three states:

1. **Hidden** — default on startup and after selection. Window is invisible, not destroyed.
2. **Visible** — triggered by global shortcut. Window appears centred, frameless, always-on-top, with search autofocused.
3. **Dismissed** — triggered by Esc, clicking outside, or emoji selection. Window hides, focus returns to previous app.

The window is never destroyed during the app lifecycle; it is shown and hidden to avoid re-creation cost.

### Emoji injection strategy

Primary path (Wayland): use `xdg-desktop-portal` RemoteDesktop to inject the emoji character directly as keyboard input.

Fallback path (X11 or RemoteDesktop unavailable): clipboard shuffle.

1. Save current clipboard contents
2. Write selected emoji to clipboard
3. Hide picker window (OS returns focus to previous app)
4. Wait ~50ms for focus to settle
5. Simulate Ctrl+V via `enigo`
6. Wait ~50ms
7. Restore original clipboard contents

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
- Emoji injection into previously focused app (RemoteDesktop + clipboard shuffle fallback)
- System tray with context menu (Quit, Settings)
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

- [ ] Update `tauri.conf.json`:
  - `visible: false` (hidden on startup)
  - `decorations: false` (frameless)
  - `transparent: true`
  - `alwaysOnTop: true`
  - `center: true`
  - Set width/height to compact picker dimensions (~370×380)
- [ ] Update CSS to handle transparency (body background transparent, picker shell provides its own background and shadow)
- [ ] Add CSS rounded corners and drop shadow on the picker shell (visible through transparency)
- [ ] Verify the picker renders correctly as a frameless overlay

#### Phase 2: Show/hide lifecycle

- [ ] Add `show_picker` Tauri command:
  - Call `window.show()`, `window.set_focus()`, `window.center()`
  - Emit a `picker-shown` event so the frontend can autofocus search and clear previous state
- [ ] Add `hide_picker` Tauri command:
  - Call `window.hide()`
- [ ] Wire Esc key in frontend to call `hide_picker`
- [ ] Wire click-outside detection (Tauri `window.on_focus_changed` or blur event) to hide
- [ ] Frontend: on `picker-shown` event, clear search, reset scroll to top, focus search input
- [ ] Verify show → interact → hide → show cycle works without state leaks

#### Phase 3: Global shortcut registration

- [ ] Add display server detection in Rust (`WAYLAND_DISPLAY` check)
- [ ] **Wayland path:** implement real `GlobalShortcuts` portal flow in xdg-portal plugin:
  - Create a session via `ashpd::desktop::global_shortcuts::GlobalShortcuts`
  - Bind the configured shortcut
  - Listen for activation signals
  - On activation, call `show_picker`
- [ ] **X11 path:** integrate `tauri-plugin-global-shortcut`:
  - Register the configured shortcut on startup
  - On activation, call `show_picker`
- [ ] Add `xdg-portal:allow-bind-global-shortcut` and `xdg-portal:allow-unbind-global-shortcut` to the app's default capability
- [ ] Default shortcut: `Alt+Shift+E`
- [ ] Verify shortcut toggles picker visibility (press to show, press again or Esc to hide)

**Gate 1 result: shortcut opens picker, Esc/click-outside closes it, focus returns to previous app.**

### Gate 2: It injects (Phases 4–5)

Make emoji selection actually type the emoji into the target app.

#### Phase 4: Emoji injection

- [ ] Add `arboard` and `enigo` to `apps/emoji-picker/src-tauri/Cargo.toml`
- [ ] Implement clipboard shuffle in Rust:
  - Save clipboard → write emoji → hide window → delay → Ctrl+V → delay → restore clipboard
- [ ] **Wayland path:** implement `RemoteDesktop` session for direct input injection:
  - Create session via `ashpd::desktop::remote_desktop::RemoteDesktop`
  - Use `notify_keyboard_keycode` or similar to inject the emoji
  - Fall back to clipboard shuffle if session creation fails
- [ ] **X11 path:** use `enigo` to type the emoji directly, fall back to clipboard shuffle
- [ ] Update `insert_emoji` command to:
  1. Hide the picker window
  2. Wait for focus to return to previous app
  3. Inject the emoji via the appropriate method
- [ ] Add permissions for `inject_text` and `create_remote_desktop_session` to capabilities
- [ ] Handle edge cases:
  - Focus race condition (configurable delay)
  - Clipboard restore failure (log warning, don't crash)
  - RemoteDesktop permission denied (fall back gracefully)

#### Phase 5: System tray

- [ ] Create system tray icon using `TrayIconBuilder`
- [ ] Context menu items:
  - **Show Picker** — calls `show_picker`
  - **Settings** — opens settings view
  - **Quit** — exits the application
- [ ] Tray icon indicates app is running and listening
- [ ] App should not appear in the taskbar (it's a background utility)

**Gate 2 result: selecting an emoji types it into the previously focused app. Tray icon provides basic controls.**

### Gate 3: It remembers (Phases 6–7)

Add settings and polish.

#### Phase 6: Settings UI and persistence

- [ ] Add `tauri-plugin-store` to dependencies and capabilities
- [ ] Create settings store with defaults:
  ```json
  {
    "shortcut": "Alt+Shift+E",
    "skinTone": "none",
    "closeOnSelect": true
  }
  ```
- [ ] Build settings panel component:
  - Shortcut capture input (records key combination)
  - Skin tone preference dropdown
  - Close-on-select toggle
  - Save / Cancel buttons
- [ ] Add gear icon to picker header that navigates to settings panel
- [ ] Implement "flip" or slide transition between picker and settings views
- [ ] On save:
  - Persist to store
  - Re-register global shortcut with new binding
  - Apply skin tone preference
- [ ] On startup:
  - Read store values
  - Register shortcut from stored binding
  - Apply stored skin tone

#### Phase 7: Polish and edge cases

- [ ] Live theme change listener:
  - Subscribe to `org.freedesktop.portal.Settings` change signals via `ashpd`
  - Emit Tauri events to frontend
  - Frontend re-applies theme tokens on change
- [ ] Focus management hardening:
  - Tune hide-to-inject delay for different compositors
  - Handle tiling WM edge cases (Sway, i3) where focus return is unpredictable
- [ ] Esc handling: ensure Esc only hides picker, never terminates the process
- [ ] Window positioning: centre on the active monitor (not just primary)
- [ ] Startup: register for autostart if the user opts in (future)
- [ ] Error handling: surface portal permission prompts gracefully
- [ ] Performance: measure and optimise show latency (target <100ms from shortcut to visible)

**Gate 3 result: settings persist across restarts, shortcut is customisable, theme responds to live changes.**

## Dependencies to Add

| Crate / Package | Purpose | Phase |
|----------------|---------|-------|
| `tauri-plugin-global-shortcut` | X11 global shortcuts | 3 |
| `tauri-plugin-store` | Settings persistence | 6 |
| `arboard` | Clipboard read/write for shuffle | 4 |
| `enigo` | Keystroke simulation on X11 | 4 |

System runtime dependencies:
- `wl-clipboard` (Wayland clipboard access)
- `xdotool` / `libxdo-dev` (X11 input injection via `enigo`)

## Risks and Mitigations

### Focus race conditions

Hiding the window and injecting input must be sequenced carefully. If the injection fires before focus returns to the target app, the emoji is lost. Mitigation: configurable delay (default 50ms), with compositor-specific tuning if needed.

### Wayland portal permissions

Both `GlobalShortcuts` and `RemoteDesktop` require user permission via the desktop portal. The user may deny. Mitigation: detect denial, show a helpful message explaining why the permission is needed, fall back to clipboard shuffle for injection.

### Tiling window managers

On i3, Sway, Hyprland etc., hiding a window may not return focus to the previous app — it may focus the next window in the layout stack. Mitigation: before showing the picker, record the focused window ID (if available via portal or X11 APIs) and attempt to re-focus it after hiding.

### RemoteDesktop session lifetime

The `RemoteDesktop` portal session may be rejected, revoked, or time out. Mitigation: create sessions lazily, handle errors gracefully, and always have the clipboard shuffle as a working fallback.

### ashpd API stability

`ashpd` v0.9.x has a Rust future-compatibility warning. Monitor for updates. The `GlobalShortcuts` and `RemoteDesktop` portal APIs themselves are stable in `xdg-desktop-portal` 1.16+.

## File Map (anticipated)

| File | Purpose |
|------|---------|
| `apps/emoji-picker/src-tauri/src/lib.rs` | App setup, tray, shortcut routing |
| `apps/emoji-picker/src-tauri/src/injection.rs` | Clipboard shuffle and injection logic |
| `apps/emoji-picker/src-tauri/src/shortcuts.rs` | Display server detection, shortcut registration |
| `apps/emoji-picker/src/components/SettingsPanel.tsx` | Settings UI with shortcut capture |
| `apps/emoji-picker/src/hooks/useSettings.ts` | Settings state and store IPC |
| `plugins/xdg-portal/src/global_shortcuts.rs` | Real GlobalShortcuts portal implementation |
| `plugins/xdg-portal/src/remote_desktop.rs` | Real RemoteDesktop portal implementation |

## Follow-On (outside this plan)

- macOS and Windows support
- Flatpak packaging with portal permissions manifest
- Custom emoji and frequently used tracking
- Multi-monitor awareness
- Auto-update via tauri-plugin-updater
