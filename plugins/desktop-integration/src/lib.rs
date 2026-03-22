// Provides desktop-integration helpers for window activation on Linux
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use log::info;
use std::process::Command;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("desktop-integration").build()
}

pub fn request_activation_assist(source: &'static str, title: &str, label: &str) {
    let title = title.to_string();
    let label = label.to_string();

    std::thread::spawn(move || {
        for delay_ms in [100_u64, 250_u64] {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));

            match Command::new("xdotool")
                .args(["search", "--name", &format!("^{title}$"), "windowactivate"])
                .output()
            {
                Ok(output) if output.status.success() => {
                    info!(
                        "X11 activation assist succeeded for {source} label={label} delay={}ms",
                        delay_ms
                    );
                    return;
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    info!(
                        "X11 activation assist failed for {source} label={label} delay={}ms: {}",
                        delay_ms,
                        stderr.trim()
                    );
                }
                Err(error) => {
                    info!(
                        "X11 activation assist unavailable for {source} label={label} delay={}ms: {error}",
                        delay_ms
                    );
                    return;
                }
            }
        }
    });
}
