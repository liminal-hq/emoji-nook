// Clipboard-shuffle emoji injection for pasting into the previously focused app
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use arboard::Clipboard;
#[cfg(target_os = "linux")]
use arboard::SetExtLinux;
use log::{info, warn};
use std::process::Command;
use std::time::{Duration, Instant};

/// Injects an emoji into the previously focused application using the
/// clipboard shuffle technique:
///
/// 1. Save current clipboard contents
/// 2. Write emoji to clipboard (kept alive for the target app to read)
/// 3. Wait for focus to settle on the target app
/// 4. Simulate Ctrl+V
/// 5. Wait for paste to complete
/// 6. Restore original clipboard contents
pub fn clipboard_shuffle(emoji: &str, wayland: bool) {
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            warn!("failed to open clipboard: {e}");
            return;
        }
    };

    // 1. Save current clipboard
    let saved = clipboard.get_text().ok();

    // 2. Write emoji to clipboard, waiting for the clipboard manager to
    //    grab the contents so they survive after `Clipboard` is dropped
    #[cfg(target_os = "linux")]
    let set_result = clipboard
        .set()
        .wait_until(Instant::now() + Duration::from_secs(2))
        .text(emoji);
    #[cfg(not(target_os = "linux"))]
    let set_result = clipboard.set_text(emoji);

    if let Err(e) = set_result {
        warn!("failed to write emoji to clipboard: {e}");
        return;
    }
    info!("clipboard set to: {emoji}");

    // 3. Wait for focus to settle on target app
    std::thread::sleep(Duration::from_millis(100));

    // 4. Simulate Ctrl+V
    //    - Wayland (GNOME): `xdotool` via XWayland (GNOME doesn't support
    //      the `wl_virtual_keyboard` protocol that `wtype` needs)
    //    - X11: `xdotool` directly
    //    - Other Wayland compositors: try `wtype` first
    let paste_result = if wayland {
        simulate_paste_wtype().or_else(|e| {
            info!("`wtype` failed ({e}), falling back to `xdotool`");
            simulate_paste_xdotool()
        })
    } else {
        simulate_paste_xdotool().or_else(|e| {
            info!("`xdotool` failed ({e}), falling back to `wtype`");
            simulate_paste_wtype()
        })
    };
    if let Err(e) = paste_result {
        warn!("failed to simulate paste: {e}");
    }

    // 5. Wait for paste to complete before restoring
    std::thread::sleep(Duration::from_millis(150));

    // 6. Restore original clipboard
    if let Some(text) = saved {
        let mut restore_clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                warn!("failed to open clipboard for restore: {e}");
                return;
            }
        };
        if let Err(e) = restore_clipboard.set_text(&text) {
            warn!("failed to restore clipboard: {e}");
        }
    }
}

/// Simulates Ctrl+V using `xdotool` (X11 / XWayland).
fn simulate_paste_xdotool() -> Result<(), String> {
    let status = Command::new("xdotool")
        .args(["key", "--clearmodifiers", "ctrl+v"])
        .status()
        .map_err(|e| format!("`xdotool` not found: {e}"))?;

    if !status.success() {
        return Err(format!("`xdotool` exited with: {status}"));
    }
    Ok(())
}

/// Simulates Ctrl+V using `wtype` (native Wayland).
fn simulate_paste_wtype() -> Result<(), String> {
    let status = Command::new("wtype")
        .args(["-M", "ctrl", "-P", "v", "-p", "v", "-m", "ctrl"])
        .status()
        .map_err(|e| format!("`wtype` not found: {e}"))?;

    if !status.success() {
        return Err(format!("`wtype` exited with: {status}"));
    }
    Ok(())
}
