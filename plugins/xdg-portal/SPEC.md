# Project Specification: tauri-plugin-xdg-portal

## 1. Overview

`tauri-plugin-xdg-portal` is a native Rust plugin for the Tauri framework designed to bridge the gap between Tauri applications and the Linux `xdg-desktop-portal` D-Bus interfaces.

While Tauri provides cross-platform APIs, modern Linux environments (specifically Wayland and sandboxed formats like Flatpak and Snap) heavily restrict direct system access for security reasons. This plugin allows Tauri applications to securely request system resources (Global Shortcuts, Screen Casting, Input Injection, etc.) by communicating directly with the user's Desktop Environment (GNOME, KDE Plasma, Hyprland) via standard freedesktop.org portal APIs.

## 2. Workspace Integration & Architecture

This plugin is designed to be housed within a generic Tauri plugin workspace monorepo.

### 2.1 Crate Structure

- `src/`: The Rust backend handling D-Bus communication and defining the Tauri IPC commands.
- `guest-js/`: The TypeScript source files that define the `js-guest` bindings. This creates the clean, typed API that the frontend webview interacts with.
- `dist-js/`: The compiled JavaScript output (the actual `js-guest` module imported by the frontend).
- `bindings/`: Automatically generated TypeScript bindings from Rust structs (using `ts-rs` or Tauri's native type generation) to ensure type safety between Rust and JS.
- `permissions/`: Configuration files defining the security boundaries for the IPC commands.

### 2.2 Tech Stack & Dependencies

- **Rust:**
  - `ashpd`: The premier Rust wrapper for the XDG Desktop Portal D-Bus API. This drastically simplifies interacting with portals compared to writing raw `zbus` D-Bus calls.
  - `tauri`: Core framework API for plugin builders.
  - `serde` / `serde_json`: For serialising payload data between the webview and Rust.
- **TypeScript:**
  - `@tauri-apps/api`: To handle IPC `invoke` calls back to the Rust plugin.

## 3. Supported XDG Portals (Feature Roadmap)

The plugin will be modular, allowing developers to enable specific portals via Cargo feature flags to keep binary sizes minimal.

### Phase 1: Core Emoji Picker Requirements

- **`org.freedesktop.portal.GlobalShortcuts`**: Securely register global keybindings. The portal handles prompting the user to allow the shortcut and notifies the app when triggered, bypassing Wayland's keylogger protections.
- **`org.freedesktop.portal.RemoteDesktop`**: Used for input injection (simulating keystrokes). This portal allows the app to request a session to inject keyboard and mouse events into the Wayland compositor securely.

### Phase 2: Extended Desktop Capabilities

- **`org.freedesktop.portal.ScreenCast` & `Screenshot`**: Securely capture window or monitor contents without raw X11/Wayland buffer access.
- **`org.freedesktop.portal.Background`**: Request permission to run in the background or autostart on system boot (crucial for utility apps).
- **`org.freedesktop.portal.Settings`**: Read system-wide user preferences (e.g., colour scheme, accent colours, default fonts) directly from the DE.

### Out of Scope (Handled by Core Tauri)

To prevent duplication of effort and potential D-Bus conflicts, this plugin explicitly omits the following portals:

- **`org.freedesktop.portal.FileChooser`**: Already implemented by `@tauri-apps/plugin-dialog` (via the `xdg-portal` Cargo feature).
- **`org.freedesktop.portal.OpenURI`**: Handled natively by Tauri's core shell/open functionality.

## 4. API Surface Design

### 4.1 Rust Plugin Initialisation

The plugin will be initialised in the standard Tauri `Builder` pattern. It will gracefully no-op or return errors on non-Linux platforms (using `#[cfg(target_os = "linux")]`), ensuring cross-platform codebases don't break.

```rust
// In a Tauri app's main.rs
tauri::Builder::default()
    .plugin(tauri_plugin_xdg_portal::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

### 4.2 TypeScript API Example (`guest-js`)

The `guest-js` frontend will have strongly-typed promises to interact with the portals.

```ts
import { globalShortcuts, remoteDesktop } from 'tauri-plugin-xdg-portal';

// 1. Registering a Wayland-safe Global Shortcut
async function setupShortcut() {
	try {
		const session = await globalShortcuts.bind({
			id: 'open-emoji-picker',
			description: 'Trigger the global emoji picker',
			preferredTrigger: 'Alt+Shift+E',
		});

		session.onTriggered(() => {
			console.log('Shortcut activated by Wayland Compositor!');
		});
	} catch (e) {
		console.error('Portal request denied or unavailable', e);
	}
}

// 2. Injecting Text via RemoteDesktop Portal
async function injectEmoji(emoji: string) {
	const session = await remoteDesktop.createSession();
	await session.injectText(emoji);
	await session.close();
}
```

### 4.3 Security & Permissions (`default.toml`)

Tauri v2 relies on a strict capability system. The plugin must define its IPC permissions in the `permissions/` directory. Because XDG portals handle sensitive operations, this plugin follows a **secure-by-default** model.

- **`permissions/default.toml`**: The default permissions granted when an application includes this plugin's default capability. This should **only** expose harmless utility commands (e.g., checking if a portal is available):

```toml
[default]
description = "Default permissions for the XDG Portal plugin"
permissions = [
    "allow-check-availability"
]
```

- **Opt-in Permissions**: Powerful, potentially dangerous portals should be separated into their own permission files (e.g., `permissions/global-shortcuts.toml`, `permissions/remote-desktop.toml`). The app developer must explicitly add these to their app's `capabilities` configuration to use them:

```toml
# Example: permissions/global-shortcuts.toml
[[permission]]
identifier = "allow-bind-shortcut"
description = "Enables the ability to request a Global Shortcut via the XDG Portal"
commands.allow = [
    "bind_global_shortcut",
    "unbind_global_shortcut"
]
```

## 5. Known Challenges & Edge Cases

1. **Asynchronous Portal Prompts:** Unlike standard APIs, XDG portal requests often trigger native UI dialogs (e.g., "Do you want to allow this app to register a shortcut?"). The Rust backend must heavily rely on async tasks and avoid blocking the main Tauri thread while waiting for user interaction.
2. **Differing DE Implementations:** While the `xdg-desktop-portal` API is standard, backends (GNOME vs. KDE) sometimes implement features differently or have bugs. The plugin should handle unsupported feature errors gracefully.
3. **Session Management:** Portals like `GlobalShortcuts` and `RemoteDesktop` require maintaining an active D-Bus "Session" object. The Rust state manager will need to hold these session tokens securely in memory so they can be closed or reused.

## 6. Development Milestones

- [ ] **Milestone 1: Scaffold Workspace.** Set up the generic plugin workspace, configure the Rust crate to compile only on Linux, configure the `guest-js` build steps, and define initial `default.toml` permissions.
- [ ] **Milestone 2: Integrate `ashpd`.** Add the `ashpd` dependency and establish a basic D-Bus connection to the central portal service. Implement a simple ping/read of the `Settings` portal to verify connectivity.
- [ ] **Milestone 3: Global Shortcuts Portal.** Implement the `GlobalShortcuts` interface. Create the Rust command to request the binding, the IPC layer, and the TS frontend wrapper. Test on GNOME Wayland.
- [ ] **Milestone 4: Remote Desktop Portal (Input).** Implement the `RemoteDesktop` interface to allow programmatic injection of text. This fulfills the final requirement for the overarching Emoji Picker project.
- [ ] **Milestone 5: Documentation & Release.** Document the feature flags, write setup instructions for Tauri developers, and publish (optionally) to crates.io / npm.
