// Clipboard-shuffle emoji injection for pasting into the previously focused app
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use arboard::Clipboard;
#[cfg(target_os = "linux")]
use arboard::SetExtLinux;
use log::{info, warn};
use serde_json::Value;
use std::process::Command;
use std::time::{Duration, Instant};

/// Injects an emoji into the previously focused application using the
/// clipboard shuffle technique:
///
/// 1. Save current clipboard contents
/// 2. Write emoji to clipboard (handed to clipboard manager)
/// 3. Wait for focus to settle on the target app
/// 4. Simulate Ctrl+V
/// 5. Wait for paste to complete
/// 6. Restore original clipboard contents
pub fn clipboard_shuffle(emoji: &str) {
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            warn!("failed to open clipboard: {e}");
            return;
        }
    };

    // 1. Save current clipboard text.  arboard returns Err for both an empty
    //    clipboard and a clipboard holding non-text content (images, files).
    //    We treat a non-content error (ClipboardOccupied, Unknown) as "had
    //    non-text" so we skip the clear step; everything else (including an
    //    empty clipboard) gets cleared after the paste to avoid leaving the
    //    emoji sitting in the clipboard for accidental future pastes.
    let (saved, had_non_text) = match clipboard.get_text() {
        Ok(text) => (Some(text), false),
        Err(arboard::Error::ClipboardOccupied) | Err(arboard::Error::Unknown { .. }) => {
            (None, true)
        }
        Err(_) => (None, false),
    };

    // 2. Write emoji to clipboard — no `wait_until` here because we keep
    //    the `Clipboard` alive through the paste, so arboard's serve thread
    //    continues answering paste requests from the target app directly.
    if let Err(e) = clipboard.set_text(emoji) {
        warn!("failed to write emoji to clipboard: {e}");
        return;
    }
    info!("clipboard set to: {emoji}");

    // 3. Wait for focus to settle on target app
    std::thread::sleep(Duration::from_millis(100));

    // 4. Simulate Ctrl+V (Ctrl+Shift+V for terminal emulators, which
    //    intercept Ctrl+V as a control character rather than paste).
    //    Try in order: `ydotool` (kernel uinput, works everywhere),
    //    `wtype` (native Wayland), `xdotool` (X11/XWayland)
    let is_terminal = focused_window_class()
        .as_deref()
        .map(is_terminal_class)
        .unwrap_or(false);
    let paste_result = simulate_paste_ydotool(is_terminal)
        .or_else(|e| {
            info!("{e}, trying `wtype`");
            simulate_paste_wtype(is_terminal)
        })
        .or_else(|e| {
            info!("{e}, trying `xdotool`");
            simulate_paste_xdotool(is_terminal)
        });
    if let Err(e) = paste_result {
        warn!("failed to simulate paste: {e}");
    }

    // 5. Wait for paste to complete, then drop the clipboard so arboard's
    //    serve thread stops (the target app has already read the content)
    std::thread::sleep(Duration::from_millis(200));
    drop(clipboard);

    // 6. Restore original clipboard or clear it so the emoji doesn't linger
    let mut restore = match Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            warn!("failed to open clipboard for restore: {e}");
            return;
        }
    };

    if let Some(text) = saved {
        #[cfg(target_os = "linux")]
        let restore_result = restore
            .set()
            .wait_until(Instant::now() + Duration::from_millis(500))
            .text(&text);
        #[cfg(not(target_os = "linux"))]
        let restore_result = restore.set_text(&text);

        if let Err(e) = restore_result {
            warn!("failed to restore clipboard: {e}");
        }
    } else if had_non_text {
        // The clipboard held non-text content (image, files, etc.)
        // that we can't snapshot with the text API. Leave it alone —
        // the clipboard manager will have already picked up whatever
        // was there before our emoji write.
        info!("clipboard had non-text content before injection; skipping restore");
    } else {
        // Clipboard was genuinely empty — clear so the emoji doesn't
        // stay around for an accidental Ctrl+V later
        restore.clear().unwrap_or_else(|e| {
            warn!("failed to clear clipboard: {e}");
        });
    }
}

/// ydotool key codes: <keycode>:<press=1/release=0>. 29 = KEY_LEFTCTRL,
/// 42 = KEY_LEFTSHIFT, 47 = KEY_V.
fn ydotool_key_args(is_terminal: bool) -> &'static [&'static str] {
    if is_terminal {
        &["key", "29:1", "42:1", "47:1", "47:0", "42:0", "29:0"]
    } else {
        &["key", "29:1", "47:1", "47:0", "29:0"]
    }
}

/// Simulates Ctrl+V (or Ctrl+Shift+V for terminal emulators) using `ydotool`
/// (kernel uinput — works on X11, Wayland, GNOME, KDE, Sway, etc.). Requires
/// `ydotoold` running.
fn simulate_paste_ydotool(is_terminal: bool) -> Result<(), String> {
    let status = Command::new("ydotool")
        .args(ydotool_key_args(is_terminal))
        .status()
        .map_err(|e| format!("`ydotool` not found: {e}"))?;

    if !status.success() {
        return Err(format!("`ydotool` exited with: {status}"));
    }
    Ok(())
}

/// Returns the class/app_id of the focused window, used to detect terminal
/// emulators (which need Ctrl+Shift+V instead of Ctrl+V). No single tool
/// covers every compositor, so backends are tried in order:
///   1. `hyprctl` (Hyprland)
///   2. `swaymsg` (Sway and other compositors implementing its IPC)
///   3. `xdotool` + `xprop` (X11 / XWayland)
fn focused_window_class() -> Option<String> {
    focused_window_class_hyprland()
        .or_else(focused_window_class_sway)
        .or_else(focused_window_class_x11)
}

/// Returns the focused window's class via `hyprctl activewindow -j`.
/// Hyprland reports the `class` field for both native and XWayland clients.
fn focused_window_class_hyprland() -> Option<String> {
    let output = Command::new("hyprctl")
        .args(["activewindow", "-j"])
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    let window: Value = serde_json::from_slice(&output.stdout).ok()?;
    window
        .get("class")
        .and_then(Value::as_str)
        .map(str::to_lowercase)
}

/// Returns the focused window's class via `swaymsg -t get_tree`.
fn focused_window_class_sway() -> Option<String> {
    let output = Command::new("swaymsg")
        .args(["-t", "get_tree"])
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    let tree: Value = serde_json::from_slice(&output.stdout).ok()?;
    find_focused_class(&tree)
}

/// Recursively walks a sway/i3-IPC tree node for the focused window,
/// returning its `app_id` (native Wayland client) or `window_properties.class`
/// (XWayland client), lowercased.
fn find_focused_class(node: &Value) -> Option<String> {
    if node.get("focused").and_then(Value::as_bool) == Some(true) {
        let class = node
            .get("app_id")
            .and_then(Value::as_str)
            .or_else(|| {
                node.get("window_properties")
                    .and_then(|p| p.get("class"))
                    .and_then(Value::as_str)
            })
            .map(str::to_lowercase);
        if class.is_some() {
            return class;
        }
    }
    ["nodes", "floating_nodes"]
        .iter()
        .filter_map(|key| node.get(key))
        .filter_map(Value::as_array)
        .flatten()
        .find_map(find_focused_class)
}

/// Returns the focused window's WM_CLASS via `xdotool` + `xprop` (X11 /
/// XWayland). Uses `xprop -id <wid> WM_CLASS` rather than `xdotool
/// getwindowclassname` since the latter verb is absent in older builds.
fn focused_window_class_x11() -> Option<String> {
    let id_out = Command::new("xdotool").arg("getactivewindow").output();
    let window_id = match &id_out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Ok(o) => {
            info!(
                "xdotool getactivewindow failed ({}): {}",
                o.status,
                String::from_utf8_lossy(&o.stderr).trim()
            );
            return None;
        }
        Err(e) => {
            info!("xdotool getactivewindow error: {e}");
            return None;
        }
    };

    // xprop output: WM_CLASS(STRING) = "instance", "ClassName"
    // Splitting on '"' puts quoted values at odd indices: [before, inst, sep, class, after]
    // We want index 3 (the class), i.e. the second odd-indexed token.
    let class = Command::new("xprop")
        .args(["-id", &window_id, "WM_CLASS"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).to_string();
            let after_eq = s.split('=').nth(1)?;
            // Odd-indexed segments of a quote-split are the quoted values themselves.
            after_eq
                .split('"')
                .enumerate()
                .filter(|(i, _)| i % 2 == 1)
                .nth(1)
                .map(|(_, c)| c.to_lowercase())
        });

    info!(
        "target window id={window_id} class={:?}",
        class.as_deref().unwrap_or("unknown")
    );

    class
}

/// Terminal emulators intercept Ctrl+V (verbatim-next) and require
/// Ctrl+Shift+V for paste instead. Includes both X11 WM_CLASS values and
/// the differing Wayland app_id some of these report (e.g. GNOME Terminal,
/// Konsole).
fn is_terminal_class(class: &str) -> bool {
    matches!(
        class,
        "alacritty"
            | "foot"
            | "gnome-terminal"
            | "kitty"
            | "konsole"
            | "org.gnome.terminal"
            | "org.kde.konsole"
            | "org.wezfurlong.wezterm"
            | "rxvt"
            | "st"
            | "terminator"
            | "termite"
            | "tilix"
            | "urxvt"
            | "wezterm-gui"
            | "xfce4-terminal"
            | "xterm"
    )
}

/// Simulates Ctrl+V (or Ctrl+Shift+V for terminal emulators) using `xdotool`
/// (X11 / XWayland).
fn simulate_paste_xdotool(is_terminal: bool) -> Result<(), String> {
    let key = if is_terminal {
        "ctrl+shift+v"
    } else {
        "ctrl+v"
    };
    info!("xdotool paste: key={key} terminal={is_terminal}");

    let status = Command::new("xdotool")
        .args(["key", "--clearmodifiers", key])
        .status()
        .map_err(|e| format!("`xdotool` not found: {e}"))?;

    if !status.success() {
        return Err(format!("`xdotool` exited with: {status}"));
    }
    Ok(())
}

/// wtype modifier/key sequence for Ctrl+V, or Ctrl+Shift+V for terminals.
fn wtype_key_args(is_terminal: bool) -> &'static [&'static str] {
    if is_terminal {
        &[
            "-M", "ctrl", "-M", "shift", "-P", "v", "-p", "v", "-m", "shift", "-m", "ctrl",
        ]
    } else {
        &["-M", "ctrl", "-P", "v", "-p", "v", "-m", "ctrl"]
    }
}

/// Simulates Ctrl+V (or Ctrl+Shift+V for terminal emulators) using `wtype`
/// (native Wayland, needs compositor support).
fn simulate_paste_wtype(is_terminal: bool) -> Result<(), String> {
    let status = Command::new("wtype")
        .args(wtype_key_args(is_terminal))
        .status()
        .map_err(|e| format!("`wtype` not found: {e}"))?;

    if !status.success() {
        return Err(format!("`wtype` exited with: {status}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn is_terminal_class_matches_x11_and_wayland_forms() {
        assert!(is_terminal_class("kitty"));
        assert!(is_terminal_class("gnome-terminal"));
        assert!(is_terminal_class("org.gnome.terminal"));
        assert!(is_terminal_class("konsole"));
        assert!(is_terminal_class("org.kde.konsole"));
        assert!(!is_terminal_class("firefox"));
        assert!(!is_terminal_class("code"));
    }

    #[test]
    fn ydotool_key_args_add_shift_for_terminals() {
        assert_eq!(
            ydotool_key_args(false),
            &["key", "29:1", "47:1", "47:0", "29:0"]
        );
        assert_eq!(
            ydotool_key_args(true),
            &["key", "29:1", "42:1", "47:1", "47:0", "42:0", "29:0"]
        );
    }

    #[test]
    fn wtype_key_args_add_shift_for_terminals() {
        assert_eq!(
            wtype_key_args(false),
            &["-M", "ctrl", "-P", "v", "-p", "v", "-m", "ctrl"]
        );
        assert_eq!(
            wtype_key_args(true),
            &["-M", "ctrl", "-M", "shift", "-P", "v", "-p", "v", "-m", "shift", "-m", "ctrl",]
        );
    }

    #[test]
    fn find_focused_class_reads_native_app_id() {
        let tree = json!({
            "nodes": [{
                "focused": false,
                "app_id": "firefox",
                "nodes": [],
                "floating_nodes": []
            }, {
                "focused": true,
                "app_id": "foot",
                "nodes": [],
                "floating_nodes": []
            }]
        });
        assert_eq!(find_focused_class(&tree), Some("foot".to_string()));
    }

    #[test]
    fn find_focused_class_falls_back_to_xwayland_window_properties() {
        let tree = json!({
            "nodes": [{
                "focused": true,
                "app_id": null,
                "window_properties": { "class": "Xterm" },
                "nodes": [],
                "floating_nodes": []
            }]
        });
        assert_eq!(find_focused_class(&tree), Some("xterm".to_string()));
    }

    #[test]
    fn find_focused_class_searches_floating_nodes() {
        let tree = json!({
            "nodes": [],
            "floating_nodes": [{
                "focused": true,
                "app_id": "kitty",
                "nodes": [],
                "floating_nodes": []
            }]
        });
        assert_eq!(find_focused_class(&tree), Some("kitty".to_string()));
    }

    #[test]
    fn find_focused_class_returns_none_when_nothing_focused() {
        let tree = json!({
            "nodes": [{
                "focused": false,
                "app_id": "firefox",
                "nodes": [],
                "floating_nodes": []
            }]
        });
        assert_eq!(find_focused_class(&tree), None);
    }
}
