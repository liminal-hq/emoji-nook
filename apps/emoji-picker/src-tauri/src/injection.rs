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

    // 1. Save current clipboard
    let saved = clipboard.get_text().ok();

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

    // 4. Simulate Ctrl+V
    //    Try in order: `ydotool` (kernel uinput, works everywhere),
    //    `wtype` (native Wayland), `xdotool` (X11/XWayland)
    let paste_result = simulate_paste_ydotool()
        .or_else(|e| {
            info!("{e}, trying `wtype`");
            simulate_paste_wtype()
        })
        .or_else(|e| {
            info!("{e}, trying `xdotool`");
            simulate_paste_xdotool()
        });
    if let Err(e) = paste_result {
        warn!("failed to simulate paste: {e}");
    }

    // 5. Wait for paste to complete, then drop the clipboard so arboard's
    //    serve thread stops (the target app has already read the content)
    std::thread::sleep(Duration::from_millis(200));
    drop(clipboard);

    // 6. Restore original clipboard via clipboard manager handover
    if let Some(text) = saved {
        let mut restore = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                warn!("failed to open clipboard for restore: {e}");
                return;
            }
        };
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
    }
}

/// Simulates Ctrl+V using `ydotool` (kernel uinput — works on X11, Wayland,
/// GNOME, KDE, Sway, etc.). Requires `ydotoold` running.
fn simulate_paste_ydotool() -> Result<(), String> {
    // ydotool key: 29 = KEY_LEFTCTRL, 47 = KEY_V
    // Format: <keycode>:<press=1/release=0>
    let status = Command::new("ydotool")
        .args(["key", "29:1", "47:1", "47:0", "29:0"])
        .status()
        .map_err(|e| format!("`ydotool` not found: {e}"))?;

    if !status.success() {
        return Err(format!("`ydotool` exited with: {status}"));
    }
    Ok(())
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

/// Simulates Ctrl+V using `wtype` (native Wayland, needs compositor support).
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
