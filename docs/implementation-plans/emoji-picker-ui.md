# Emoji Picker UI Implementation Plan

This document defined the UI-validation path for `emoji-nook`. It supports, not replaces, the final behavioural requirements in `SPEC.md`.

## Goal

Build a functional, native-looking emoji picker UI inside the current known-good `emoji-nook` window shell. The picker should feel like a first-class desktop widget on GNOME, KDE, Cinnamon, MATE, and other Linux desktop environments — not a web app wearing a native costume.

The 800×600 window stays as-is for testing convenience. The picker UI targets a compact footprint (~370×340px) rendered inside that window, so the component structure is ready for the final overlay sizing without a rewrite.

Window downsizing, overlay presentation, tray, shortcuts, and injection are deferred to the desktop integration plan.

## Design Direction

### Visual target

The Windows Emoji Picker is the **functional** inspiration: a compact, keyboard-driven picker that appears on demand, supports search, and inserts emoji into the active text field. The **visual** target is native Linux desktop integration — the picker should look at home on GNOME (Adwaita), KDE (Breeze), and GTK-based desktops.

### Native theming strategy

- Detect desktop environment via `XDG_CURRENT_DESKTOP` for widget style (border radii, shadows, spacing).
- Read colour scheme, accent colour, and contrast preference from the `org.freedesktop.portal.Settings` D-Bus interface via `ashpd`.
- Do **not** rely on `prefers-color-scheme` in CSS — it is broken in Tauri/Wry on Linux. Inject theme values from the Rust side as CSS custom properties.
- Use system font stacks: Cantarell on GNOME, Noto Sans on KDE, with sensible fallbacks.
- Maintain a CSS custom property token system with style maps for Adwaita-like and Breeze-like visual treatments.

### Emoji picker library

**Frimousse** (`frimousse`, v0.3.x) — a headless, unstyled React emoji picker with:

- React 18/19 support
- ~12 kB bundle (emoji data fetched on demand and cached)
- Search, categories with sticky headers, skin tone selector, keyboard navigation
- Composable architecture — full styling freedom, no built-in styles to override
- TypeScript-first

Frimousse is pre-1.0, but the API surface is small and the composable architecture means migration risk is low.

## Scope

### In scope

- Frimousse emoji picker with search, categories, keyboard navigation, skin tones
- Native desktop theming via xdg-portal settings (colour scheme, accent colour, contrast)
- Desktop environment detection and style adaptation (Adwaita, Breeze)
- System font stacks
- Logging bridge (`@tauri-apps/plugin-log`)
- Compact picker layout (~370×340px) inside the 800×600 test window
- Local selection handling and preview
- Minimal IPC for selection events
- Category tab bar with scroll-to and active tracking
- Accessibility (ARIA roles, focus management, keyboard navigation)

### Out of scope (deferred to desktop integration plan)

- Window dimensions and overlay flags
- Tray icon behaviour
- Global shortcut registration
- Clipboard or text injection
- Settings UI and persistence
- Focus return to previous application

## Implementation Phases

### Gate 1: Picker works (Phases 1–3)

Build and prove the core picker experience.

#### Phase 1: Frontend foundations

- [x] Add `frimousse` to `apps/emoji-picker/package.json`
- [x] Add `@tauri-apps/plugin-log` for debugging
- [x] Port the logger utility (`utils/logger.ts`) bridging `console.*` to tauri-plugin-log
- [x] Confirm Frimousse renders in the WebKitGTK webview

#### Phase 2: Build the picker UI

- [x] Replace the placeholder `App.tsx` with a picker-first layout
- [x] Target a ~370×340px container centred in the 800×600 window
- [x] Implement search input with autofocus
- [x] Implement emoji category browsing with category tab bar
- [x] Implement keyboard navigation (arrow keys, Enter to select)
- [x] Implement skin tone selection
- [x] Implement preview area showing the active/last-selected emoji

#### Phase 3: Minimal interaction plumbing

- [x] Implement local selection handler updating React state
- [x] Display preview of selected emoji
- [x] Wire `insert_emoji` Tauri command proving IPC works

**Gate 1 result: passed.** Picker renders, search works, selection works, keyboard navigation works.

### Gate 2: Looks native (Phases 4–5)

Make the picker feel like a native desktop widget.

#### Phase 4: Theme detection and token system

- [x] Extend xdg-portal plugin with `get_theme_info` command returning DE, colour scheme, accent colour
- [x] Detect desktop environment from `XDG_CURRENT_DESKTOP` (Rust side)
- [x] Build CSS custom property token system with abstract tokens
- [x] Implement Adwaita style map (rounded corners, muted palette, Cantarell, libadwaita shadows)
- [x] Implement Breeze style map (tighter radii, crisper borders, Noto Sans)
- [x] Inject theme values into the webview on startup via `useTheme` hook
- [ ] Wire change listeners for live theme switching (async streams → Tauri events)

#### Phase 5: Apply native styling and polish

- [x] Style Frimousse picker components using the token system
- [x] Validate GNOME dark mode appearance
- [ ] Validate KDE Plasma appearance
- [ ] Validate with at least one non-default accent colour
- [x] Add inset focus-visible styles on all interactive elements
- [x] Add ARIA roles (radiogroup on skin tones, labelled emoji buttons)
- [x] Make emoji viewport tab-focusable for keyboard navigation
- [ ] Fix category scroll-to (pending re-test with latest build)

**Gate 2 result: in progress.** Dark mode works, theme detection works; KDE validation and live theme switching remain.

## Resolved Issues

| Issue                                         | Root Cause                                                                 | Fix                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `get_theme_info` permission denied            | `default.toml` used `[[permission]]` format instead of `[default]` section | Changed to `[default]` with `permissions` array referencing autogenerated identifiers |
| Category scroll jumped to bottom              | `offsetTop`/`offsetParent` unreliable with Frimousse DOM nesting           | Replaced with `getBoundingClientRect()` calculation                                   |
| Focus outlines clipped by container           | `overflow: hidden` on picker shell                                         | Changed to inset outlines (`outline-offset: -2px`)                                    |
| Unicode escapes rendered literally            | `\u2026` in JSX string attributes                                          | Replaced with literal `…` character                                                   |
| Vite failed to resolve `@tauri-apps/api/core` | Plugin guest-js `main` pointed to pre-built dist-js                        | Changed to `src/index.ts` for direct TypeScript resolution                            |
| `prefers-color-scheme` not working            | Broken in Tauri/Wry on Linux                                               | Theme injected from Rust via xdg-portal D-Bus interface                               |

## File Map

| File                                                    | Purpose                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/emoji-picker/src/App.tsx`                         | Root view mounting picker in shell with theme hook              |
| `apps/emoji-picker/src/App.css`                         | Token-based styles with Adwaita defaults and dark mode fallback |
| `apps/emoji-picker/src/components/EmojiPickerPanel.tsx` | Frimousse picker wrapper with search, categories, skin tones    |
| `apps/emoji-picker/src/components/CategoryBar.tsx`      | Category tab bar with IntersectionObserver tracking             |
| `apps/emoji-picker/src/components/PickerShell.tsx`      | Compact container at target dimensions                          |
| `apps/emoji-picker/src/hooks/useTheme.ts`               | Theme detection and CSS property injection                      |
| `apps/emoji-picker/src/utils/logger.ts`                 | Console-to-log bridge                                           |
| `plugins/xdg-portal/src/commands.rs`                    | Plugin IPC commands including `get_theme_info`                  |
| `plugins/xdg-portal/src/linux.rs`                       | D-Bus portal reads and DE detection                             |
| `plugins/xdg-portal/src/models.rs`                      | ThemeInfo, ColourScheme, DesktopEnvironment types               |

## Risks and Mitigations

### Frimousse maturity

Frimousse is v0.3.x (pre-1.0). Mitigated by small API surface, composable/headless architecture keeping our styling independent, and fallback to `emoji-picker-react` if needed.

### WebKitGTK emoji rendering

The WebKitGTK webview may have quirks with colour emoji fonts. Testing inside the known-good window isolates this from the runtime shell.

### Theme detection coverage

Not all desktop environments support accent colour via xdg-desktop-portal. The design has sensible defaults that look acceptable without accent colour data. Colour scheme (dark/light) has broader support and is the minimum viable signal.

### Tauri plugin permissions

Local plugins require `[default]` section format in `permissions/default.toml` (not `[[permission]]`), and `cargo build` (not `cargo check`) is required to populate the app's ACL manifests. Documented in resolved issues above.

## Follow-On

This plan's output feeds into the desktop integration plan covering:

- Global shortcut registration (xdg-portal on Wayland, plugin-global-shortcut on X11)
- Window overlay behaviour (frameless, transparent, always-on-top, centre)
- Focus management and show/hide lifecycle
- Text injection (xdg-portal RemoteDesktop on Wayland, enigo on X11)
- Settings UI with store persistence
- System tray
