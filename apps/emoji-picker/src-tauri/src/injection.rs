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

/// Returns the WM_CLASS class name and window name of the focused X11 window.
/// Uses xdotool for the window ID and name, xprop for WM_CLASS (xdotool's
/// getwindowclassname verb is absent in older builds on this system).
fn focused_window_info() -> (Option<String>, Option<String>) {
    let id_out = Command::new("xdotool").arg("getactivewindow").output();
    let window_id = match &id_out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Ok(o) => {
            info!(
                "xdotool getactivewindow failed ({}): {}",
                o.status,
                String::from_utf8_lossy(&o.stderr).trim()
            );
            return (None, None);
        }
        Err(e) => {
            info!("xdotool getactivewindow error: {e}");
            return (None, None);
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

    let name = Command::new("xdotool")
        .args(["getwindowname", &window_id])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    info!(
        "target window id={window_id} class={:?} name={:?}",
        class.as_deref().unwrap_or("unknown"),
        name.as_deref().unwrap_or("unknown")
    );

    (class, name)
}

/// Terminal emulators intercept Ctrl+V (verbatim-next) and require
/// Ctrl+Shift+V for paste instead.
fn is_terminal_class(class: &str) -> bool {
    matches!(
        class,
        "alacritty"
            | "foot"
            | "gnome-terminal"
            | "kitty"
            | "konsole"
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

/// Simulates Ctrl+V using `xdotool` (X11 / XWayland).
/// Detects terminal emulators and uses Ctrl+Shift+V for those, since
/// terminals intercept Ctrl+V as a control character rather than paste.
fn simulate_paste_xdotool() -> Result<(), String> {
    let (class, _name) = focused_window_info();
    let is_terminal = class.as_deref().map(is_terminal_class).unwrap_or(false);
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
