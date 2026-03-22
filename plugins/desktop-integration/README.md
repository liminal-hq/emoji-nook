# tauri-plugin-desktop-integration

`tauri-plugin-desktop-integration` is Emoji Nook's small platform-integration plugin for desktop activation quirks that do not belong in the app crate.

Today it is focused on Linux X11 activation under Cinnamon/Muffin:

- It requests native GTK window presentation with a real event timestamp.
- It stamps `_NET_WM_USER_TIME` through `gdkx11` so fresh picker windows look like legitimate user-driven activations.
- It keeps that behaviour isolated from the app's picker lifecycle logic.

## Layout

- `src/lib.rs`: backend integration hooks used by the Tauri app.
- `build.rs`: Tauri plugin metadata and permission manifest generation.
- `permissions/default.toml`: default permission set for the plugin.
- `guest-js/`: guest-side package placeholder for future frontend-facing helpers.

## Commands and permissions

The plugin does not expose any frontend-invokable commands yet. It is a backend-only integration plugin, so its default permission set is intentionally empty for now.

The Rust side is exposed as a direct extension trait instead of an invoke command surface. That matches how many Tauri plugins expose backend-only helpers while still keeping the normal plugin metadata, permissions, and guest package structure in place.

The plugin still carries normal Tauri plugin scaffolding so it can grow cleanly if we later add frontend-facing APIs or platform-specific helpers.
