# Emoji UI Porting Plan

This document defines a UI-validation path for `emoji-nook` and is intended to support, not replace, the final behavioural requirements in `SPEC.md`.

## Goal

Build a functional, native-looking emoji picker UI inside the current known-good `emoji-nook` window shell. The picker should feel like a first-class desktop widget on GNOME, KDE, Cinnamon, MATE, and other Linux desktop environments — not a web app wearing a native costume.

The current 800×600 window stays as-is for testing convenience. The picker UI itself targets a compact footprint (~370×340px) rendered inside that window, so the component structure is ready for the final overlay sizing without a rewrite.

Window downsizing, overlay presentation, tray, shortcuts, and injection are deferred until the picker experience is proven.

## Design Direction

### Visual target

The Windows Emoji Picker is the **functional** inspiration: a compact, keyboard-driven picker that appears on demand, supports search, and inserts emoji into the active text field. The **visual** target is native Linux desktop integration — the picker should look at home on GNOME (Adwaita), KDE (Breeze), and GTK-based desktops (Cinnamon, MATE).

### Native theming strategy

- Detect desktop environment via `XDG_CURRENT_DESKTOP` for widget style (border radii, shadows, spacing).
- Read colour scheme, accent colour, and contrast preference from the `org.freedesktop.portal.Settings` D-Bus interface via `ashpd` (already partially wired in the xdg-portal plugin).
- Do **not** rely on `prefers-color-scheme` in CSS — it is broken in Tauri/Wry on Linux. Inject theme values from the Rust side via IPC as CSS custom properties.
- Use system font stacks: Cantarell on GNOME, Noto Sans on KDE, with sensible fallbacks.
- Maintain a CSS custom property token system with style maps for Adwaita-like and Breeze-like visual treatments. GTK-based desktops (Cinnamon, MATE) use the Adwaita map as a baseline.

### Emoji picker library

**Frimousse** (`frimousse`, v0.3.x) — a headless, unstyled React emoji picker with:

- React 18/19 support
- ~12 kB bundle (emoji data fetched on demand and cached)
- Search, categories with sticky headers, skin tone selector, keyboard navigation
- Composable architecture — full styling freedom, no built-in styles to override
- TypeScript-first

This replaces the earlier `emoji-mart` plan. `emoji-mart` is effectively unmaintained (last release April 2024) and has unresolved React 19 compatibility issues.

Frimousse is pre-1.0, but the API surface for an emoji picker is small and the composable architecture means migration risk is low.

## Review Summary

### What the source project provides as reference

The downloaded project at `/home/scott/Downloads/tauri-emoji-picker/` contains:

- Backend scaffolding in `lib.rs`: display-server detection, `show_picker`/`hide_picker`/`insert_emoji` commands, tray setup, WebKit environment variable workarounds
- A logging helper (`utils/logger.ts`) that bridges `console.*` to `@tauri-apps/plugin-log`
- Styling reference (`styles.css`) with flip-card animation and IBM Plex Sans typography
- Frontend dependency choices that informed (but are now superseded by) this plan

The source project does **not** contain a working emoji picker UI. The checked-in frontend is a "hello world" placeholder. This is a build task, not a copy-paste port.

### What the target workspace currently contains

- A known-good Tauri window (800×600) defined in `tauri.conf.json`
- A placeholder React starter UI in `App.tsx`
- Minimal Rust runtime wiring in `lib.rs`
- An xdg-portal plugin with `ashpd` integration that already calls `Settings::new()` and `color_scheme()`

## Alignment With SPEC

The plan and the SPEC are aligned on the end state. Where this plan differs is only in execution order:

- `SPEC.md` describes the full intended product behaviour
- This plan isolates a UI-rendering and theming validation phase first

If the UI spike succeeds, later phases resume the broader SPEC milestones.

## Scope

### In scope for this plan

- Frimousse emoji picker with search, categories, keyboard navigation, skin tones
- Native desktop theming via xdg-portal settings (colour scheme, accent colour, contrast)
- Desktop environment detection and style adaptation (Adwaita, Breeze)
- System font stacks
- Logging bridge (`@tauri-apps/plugin-log`)
- Compact picker layout (~370×340px) inside the 800×600 test window
- Local selection handling and preview
- Minimal IPC for selection events

### Explicitly out of scope

- Changing `tauri.conf.json` window dimensions or flags
- Tray icon behaviour
- Global shortcut registration
- Clipboard or text injection
- Display-server-specific runtime behaviour (beyond theme detection)
- Settings UI and persistence

These items remain in scope for the full product described in `SPEC.md`; they are only deferred.

## Proposed Implementation Plan

### Review Gate 1: Picker works (Phases 1–3)

Build and prove the core picker experience. Review before moving to theming.

#### Phase 1: Frontend foundations

- Add `frimousse` to `apps/emoji-picker/package.json`.
- Add `@tauri-apps/plugin-log` for debugging.
- Port the logger utility from the source project (`utils/logger.ts`).
- Confirm Frimousse renders in the WebKitGTK webview (smoke test).

#### Phase 2: Build the picker UI

- Replace the placeholder `App.tsx` with a picker-first layout.
- Target a ~370×340px container centred in the 800×600 window.
- Implement:
  - search input with autofocus
  - emoji category browsing
  - keyboard navigation (arrow keys, Enter to select)
  - skin tone selection
  - a visible "last selected" preview area
- Keep the UI self-contained — no tray or shortcut dependencies.
- Structure components so the settings flip/panel can be added later without restructuring.

#### Phase 3: Minimal interaction plumbing

- Implement a local selection handler:
  - update React state with the selected emoji
  - display a preview/last-picked section
  - optionally call a minimal Tauri command (`insert_emoji`) to prove IPC works
- Only add Rust commands that are necessary to validate the UI→backend path.

**Review gate: picker renders, search works, selection works, keyboard navigation works.**

### Review Gate 2: Looks native (Phases 4–5)

Make the picker feel like a native desktop widget. Review before adding settings.

#### Phase 4: Theme detection and token system

- Extend the xdg-portal plugin to expose:
  - `colour_scheme()` (dark/light/no preference)
  - `accent_colour()` (RGB tuple)
  - `contrast()` (normal/high)
  - Change listeners for all three (async streams → Tauri events)
- Detect desktop environment from `XDG_CURRENT_DESKTOP` (Rust side).
- Expose a combined `theme_info` command that returns DE, colour scheme, accent, and contrast.
- Build a CSS custom property token system:
  - Abstract tokens: `--bg-primary`, `--bg-surface`, `--accent`, `--text-primary`, `--radius-sm`, `--radius-md`, `--shadow`, `--font-family`, etc.
  - Adwaita style map: rounded corners (8–12px), muted palette, Cantarell font, libadwaita-inspired shadows
  - Breeze style map: tighter radii (4–6px), crisper borders, Noto Sans font
  - GTK-based fallback (Cinnamon, MATE): use Adwaita map with the detected accent colour
- Inject theme values into the webview on startup and on change events.

#### Phase 5: Apply native styling to the picker

- Style the Frimousse picker components using the token system.
- Validate appearance under:
  - GNOME light + dark
  - KDE Plasma light + dark
  - At least one accent colour variant
- Refine typography, spacing, and container sizing for the compact layout.

**Review gate: picker looks native on GNOME and KDE, responds to dark/light switching.**

### Future phases (outside this plan, covered by SPEC)

- Settings UI with flip/panel concept
- Store persistence for settings
- Tray icon and background process
- Global shortcut registration (xdg-portal on Wayland, plugin-global-shortcut on X11)
- Text injection (xdg-portal RemoteDesktop on Wayland, enigo on X11)
- Window overlay behaviour (frameless, transparent, always-on-top, centre)
- Focus management and clipboard shuffle fallback

## Suggested File-Level Sequence

1. Update `apps/emoji-picker/package.json` with `frimousse` and `@tauri-apps/plugin-log`.
2. Add `apps/emoji-picker/src/utils/logger.ts` (ported from source project).
3. Add picker components under `apps/emoji-picker/src/components/`:
   - `EmojiPicker.tsx` — main picker wrapper around Frimousse
   - `PickerShell.tsx` — compact container with layout structure
4. Replace `apps/emoji-picker/src/App.tsx` with the picker entry view.
5. Replace `apps/emoji-picker/src/App.css` with picker-oriented styles using CSS custom properties.
6. Extend `plugins/xdg-portal/src/commands.rs` with theme-related commands.
7. Add a theme hook or context provider under `apps/emoji-picker/src/hooks/` or `src/theme/`.
8. Only if needed for Phase 3, add a minimal `insert_emoji` command to `apps/emoji-picker/src-tauri/src/lib.rs`.

## Risks and Unknowns

### Frimousse maturity

Frimousse is v0.3.x (pre-1.0). The API may evolve. The risk is mitigated by:

- Small API surface (emoji picker is a constrained problem)
- Composable/headless architecture means our styling code is independent of the library internals
- If it breaks, swapping to `emoji-picker-react` (styled, larger bundle) is a fallback

### WebKitGTK rendering

The WebKitGTK webview may have rendering quirks with emoji glyphs, particularly colour emoji fonts. Testing inside the known-good window isolates this: if emoji render here, the issue is not the runtime shell.

### Theme detection coverage

Not all desktop environments support accent colour via xdg-desktop-portal. The design should have sensible defaults that look acceptable without accent colour data. Colour scheme (dark/light) has broader support and is the minimum viable signal.

### `prefers-color-scheme` is broken in Wry

Tauri/Wry on Linux does not reliably propagate `prefers-color-scheme`. The plan accounts for this by injecting theme values from the Rust side. Do not rely on the CSS media query for theme switching.

## Milestones

### Milestone 1 (after Phase 3): Picker works

- Frimousse emoji picker mounted and rendering
- Search filters emoji in real time
- Keyboard navigation works (arrow keys + Enter)
- Emoji selection updates local state and shows a preview
- Logger bridge working for debugging
- Compact layout (~370×340px) inside the test window

### Milestone 2 (after Phase 5): Looks native

- Picker adapts to GNOME Adwaita and KDE Breeze visual styles
- Dark/light mode detected and applied via xdg-portal
- Accent colour applied where available
- System fonts used per desktop environment
- Responsive to live theme changes

## Follow-On Mapping To SPEC

- This plan's picker UI work feeds into `SPEC.md` Phase 1
- Theme detection extends `SPEC.md` Phase 2 (xdg-portal plugin)
- Settings UI (deferred) feeds into `SPEC.md` Phase 3
- IPC plumbing feeds into `SPEC.md` Phase 5
- Deferred shortcut, tray, and injection work remains covered by `SPEC.md` Phases 2, 4, 6, and 7
