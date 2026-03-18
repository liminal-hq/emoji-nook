# Debugging Tauri v2 Plugin Permissions: What the Docs Don't Tell You

**TL;DR** — If your custom Tauri v2 plugin compiles fine but commands fail at runtime with "permission denied", your `default.toml` is probably in the wrong format. Here's how we figured that out while building Emoji Nook's `tauri-plugin-xdg-portal`.

---

## Context: A Plugin That Compiled but Didn't Work

Emoji Nook is a native Linux emoji picker built with Tauri v2. It needs to talk to `xdg-desktop-portal` over D-Bus to read the user's theme, accent colour, and colour scheme — so the picker can match whatever desktop environment it's running on.

To do that, we built a custom Tauri v2 plugin called `tauri-plugin-xdg-portal`. It lives in its own crate with a proper `build.rs`, permission manifests, and IPC commands:

```rust
#[tauri::command]
pub async fn check_availability() -> Result<AvailabilityInfo, PortalError> {
    linux::check_availability().await
}

#[tauri::command]
pub async fn get_theme_info() -> Result<ThemeInfo, PortalError> {
    linux::get_theme_info().await
}
```

The plugin registered these commands in `lib.rs`:

```rust
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("xdg-portal")
        .invoke_handler(tauri::generate_handler![
            commands::check_availability,
            commands::get_theme_info,
            commands::bind_global_shortcut,
            commands::unbind_global_shortcut,
            commands::create_remote_desktop_session,
            commands::inject_text,
            commands::close_remote_desktop_session,
        ])
        .build()
}
```

Everything compiled. The frontend called `invoke("plugin:xdg-portal|get_theme_info")`. And we got: **permission denied**.

No stack trace. No helpful error message pointing at the permission file. Just a flat rejection at the IPC layer.

## How Tauri v2's Capability System Works

Tauri v2 replaced Tauri v1's allowlist with a full capability-based permission system. The core idea is **no ambient authority** — every IPC command must be explicitly granted. Here's how the pieces fit together:

1. **Plugins declare permissions** in a `permissions/` directory using TOML files
2. **The build system** processes `#[tauri::command]` functions and generates permission identifiers like `allow-get-theme-info` and `allow-check-availability`
3. **The plugin's `default.toml`** bundles those auto-generated identifiers into a default permission set
4. **The app's capability file** (e.g., `capabilities/default.json`) opts into plugin permissions by referencing `<plugin-name>:default` or individual identifiers

If any link in that chain is broken, the command gets denied at runtime. The system is sound — it's just not very vocal about what went wrong.

## The Wrong Format (That Compiles Without Warnings)

Our initial `default.toml` looked like this:

```toml
[[permission]]
identifier = "allow-get-theme-info"
description = "Allows the get_theme_info command"
commands.allow = ["get_theme_info"]

[[permission]]
identifier = "allow-check-availability"
description = "Allows the check_availability command"
commands.allow = ["check_availability"]
```

This is valid TOML. It parses. The build completes without a single warning or error. The plugin loads at runtime — you can see the `[xdg-portal plugin] init() entered` log line.

But the commands are denied anyway.

The problem is that `[[permission]]` blocks define *individual* permission entries, but they don't get bundled into the `default` permission set that the app references with `xdg-portal:default`. They're orphaned declarations — the build system accepts them, the runtime ignores them when resolving the `default` grant, and you get a silent "permission denied".

## The Right Format

The correct `default.toml` uses a `[default]` section that references the auto-generated permission identifiers:

```toml
[default]
description = "Default permissions for the xdg-portal plugin"
permissions = [
  "allow-check-availability",
  "allow-get-theme-info",
]
```

That's it. The auto-generated identifiers — `allow-check-availability`, `allow-get-theme-info`, and so on — are created by the Tauri build script when it processes the `#[tauri::command]` functions registered in `generate_handler!`. The `[default]` section bundles them into a named permission set. The app's capability file references that set:

```json
{
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "xdg-portal:default",
    "xdg-portal:allow-bind-global-shortcut",
    "xdg-portal:allow-unbind-global-shortcut"
  ]
}
```

Note that `xdg-portal:default` pulls in everything listed in the `[default]` section, and you can also reference individual permissions like `xdg-portal:allow-bind-global-shortcut` for commands not included in the default set.

## The `cargo build` vs `cargo check` Gotcha

While debugging this, we hit a second issue that compounded the confusion.

`cargo check` runs type checking and borrow checking but doesn't execute build scripts fully. The auto-generated permission identifiers live in `gen/schemas/acl-manifests.json`, and that file only gets fully populated during a real `cargo build`.

If you're inspecting `acl-manifests.json` to verify your permissions show up and you've only been running `cargo check`, you're looking at stale data. The identifiers won't be there, and you'll think your permissions aren't being generated — when really the build script just hasn't had a chance to run.

Always run a full `cargo build` before checking generated manifests.

## How We Actually Figured It Out

We had a working Tauri v2 app with a custom plugin at a separate project path (`~/source/threshold`). The plugin there used the `[default]` section format. Ours used `[[permission]]` blocks.

The fix was a one-line structural change to `default.toml`. No code changes. No dependency updates. Just the right TOML format.

The lesson: when the documentation is ambiguous or you're unsure whether your usage is correct, **find working code and compare**. Docs can lag behind releases. Error messages can be unhelpful. But a working example doesn't lie.

## Checklist for Tauri v2 Plugin Authors

If you're writing a custom Tauri v2 plugin and your commands are being denied at runtime:

- **Use the `[default]` section format** in `permissions/default.toml`, not `[[permission]]` blocks. The `[default]` section bundles auto-generated identifiers into the default permission set.

- **Reference auto-generated identifiers** like `allow-<command-name>`. These are created from the functions you pass to `generate_handler!`. You don't need to define them yourself — just reference them.

- **Run `cargo build`**, not just `cargo check`. Build scripts that generate permission manifests only execute during a full build.

- **Inspect `gen/schemas/acl-manifests.json`** to verify your permission identifiers actually appear. If they're missing, the build script didn't process your commands.

- **Check the app's capability file** (`capabilities/default.json` or similar). It must include `<plugin-name>:default` or individual `<plugin-name>:allow-<command>` entries for every command the frontend calls.

- **Look for the plugin init log** to confirm the plugin is loading at all. A permission denial means the plugin loaded but the specific command wasn't granted — that's a different failure mode from the plugin not being registered.

- **Compare against working code**. If you have another Tauri v2 project with a working custom plugin, diff the permission files. The format differences are subtle enough to miss on visual inspection but obvious in a side-by-side diff.

---

*(c) 2026 Liminal HQ, Scott Morris*
