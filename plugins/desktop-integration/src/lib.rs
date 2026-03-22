// Provides desktop-integration helpers for window activation on Linux
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use gtk::glib::object::Cast;
use gtk::prelude::*;
use log::info;
use std::process::Command;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime, WebviewWindow,
};

use gdkx11::functions::x11_get_server_time;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("desktop-integration").build()
}

fn request_x11_user_time<R: Runtime>(
    window: &WebviewWindow<R>,
    source: &'static str,
    label: &str,
) -> Option<u64> {
    let gtk_window = match window.gtk_window() {
        Ok(window) => window,
        Err(error) => {
            info!("native X11 activation unavailable for {source} label={label}: {error}");
            return None;
        }
    };

    let mut timestamp = gtk::current_event_time();
    let mut xid = None;

    if let Some(gdk_window) = gtk_window.window() {
        if let Ok(x11_window) = gdk_window.downcast::<gdkx11::X11Window>() {
            xid = Some(x11_window.xid() as u64);

            let server_time = x11_get_server_time(&x11_window);
            if server_time != 0 {
                timestamp = server_time;
                x11_window.set_user_time(server_time);
            }
        }
    }

    if timestamp == 0 {
        if let Ok(x11_display) = gtk_window.display().downcast::<gdkx11::X11Display>() {
            let display_user_time = x11_display.user_time();
            if display_user_time != 0 {
                timestamp = display_user_time;
            }
        }
    }

    gtk_window.present_with_time(timestamp);
    info!(
        "native X11 activation requested for {source} label={label} timestamp={timestamp} xid={:?}",
        xid
    );

    xid
}

fn spawn_xdotool_fallback(source: &'static str, title: String, label: String, xid: Option<u64>) {
    std::thread::spawn(move || {
        for delay_ms in [100_u64, 250_u64] {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));

            let result = if let Some(xid) = xid {
                Command::new("xdotool")
                    .args(["windowactivate", &xid.to_string()])
                    .output()
            } else {
                Command::new("xdotool")
                    .args(["search", "--name", &format!("^{title}$"), "windowactivate"])
                    .output()
            };

            match result {
                Ok(output) if output.status.success() => {
                    info!(
                        "X11 activation assist succeeded for {source} label={label} delay={}ms xid={:?}",
                        delay_ms, xid
                    );
                    return;
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    info!(
                        "X11 activation assist failed for {source} label={label} delay={}ms xid={:?}: {}",
                        delay_ms,
                        xid,
                        stderr.trim()
                    );
                }
                Err(error) => {
                    info!(
                        "X11 activation assist unavailable for {source} label={label} delay={}ms xid={:?}: {error}",
                        delay_ms, xid
                    );
                    return;
                }
            }
        }
    });
}

pub fn request_activation_assist<R: Runtime>(
    window: &WebviewWindow<R>,
    source: &'static str,
    title: &str,
    label: &str,
) {
    let title = title.to_string();
    let label = label.to_string();
    let window = window.clone();
    let fallback_title = title.clone();
    let fallback_label = label.clone();
    let fallback_window = window.clone();

    match fallback_window.run_on_main_thread(move || {
        let xid = request_x11_user_time(&window, source, &label);
        spawn_xdotool_fallback(source, title, label, xid);
    }) {
        Ok(()) => {}
        Err(error) => {
            info!(
                "failed to schedule native X11 activation for {source} label={fallback_label}: {error}"
            );
            spawn_xdotool_fallback(source, fallback_title, fallback_label, None);
        }
    }
}
