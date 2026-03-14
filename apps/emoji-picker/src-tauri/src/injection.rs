// Clipboard-shuffle emoji injection for pasting into the previously focused app
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use arboard::Clipboard;
use log::{info, warn};
use std::process::Command;

/// Injects an emoji into the previously focused application using the
/// clipboard shuffle technique:
///
/// 1. Save current clipboard contents
/// 2. Write emoji to clipboard
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

    // 1. Save current clipboard
    let saved = clipboard.get_text().ok();

    // 2. Write emoji to clipboard
    if let Err(e) = clipboard.set_text(emoji) {
        warn!("failed to write emoji to clipboard: {e}");
        return;
    }
    info!("clipboard set to: {emoji}");

    // 3. Wait for focus to settle on target app
    std::thread::sleep(std::time::Duration::from_millis(80));

    // 4. Simulate Ctrl+V — try `xdotool` first (works on X11 and XWayland),
    //    fall back to `wtype` for native Wayland apps
    let paste_result = simulate_paste_xdotool().or_else(|e| {
        info!("xdotool failed ({e}), trying wtype");
        simulate_paste_wtype()
    });
    if let Err(e) = paste_result {
        warn!("failed to simulate paste: {e}");
    }

    // 5. Wait for paste to complete
    std::thread::sleep(std::time::Duration::from_millis(80));

    // 6. Restore original clipboard
    if let Some(text) = saved {
        if let Err(e) = clipboard.set_text(&text) {
            warn!("failed to restore clipboard: {e}");
        }
    }
}

/// Simulates Ctrl+V using `xdotool` (works on X11 and XWayland).
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
