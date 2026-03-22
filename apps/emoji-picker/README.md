# Emoji Picker

Emoji Nook is a tray-backed Tauri desktop emoji picker for Linux. The app keeps a background process alive for the tray icon, global shortcut, settings store, and injection pipeline, then creates a fresh picker window each time you open it.

## Development

From the workspace root:

- `pnpm dev` runs the app in development mode
- `pnpm build` builds the frontend package
- `pnpm lint` runs the shared frontend lint pass
- `pnpm typecheck` runs the shared TypeScript checks

## Window Lifecycle

The picker window is intentionally disposable:

- the app process starts in the background with no picker window at all
- showing the picker closes any stale picker window and creates a fresh `picker-*` window from the Tauri window config
- selecting an emoji, pressing `Esc`, or losing focus closes the picker window entirely

This keeps each activation on a clean UI state and gives X11 window managers a genuinely fresh window to focus.

On X11, the app also uses the desktop-integration plugin to stamp the fresh picker window with native GTK/X11 user-time metadata and present it with that timestamp. If the window manager still does not hand over focus cleanly, the plugin falls back to an `xdotool` activation nudge. That is what makes repeated shortcut opens behave reliably under Cinnamon/Muffin.
