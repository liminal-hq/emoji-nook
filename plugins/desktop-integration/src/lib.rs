// Provides desktop-integration helpers for window activation and shortcuts on Linux
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use gtk::glib::object::Cast;
use gtk::prelude::*;
use log::info;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Emitter, Manager, Runtime, WebviewWindow,
};

use gdkx11::functions::x11_get_server_time;

/// Payload emitted on the `shortcut-binding-result` event.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBindingResult {
    pub success: bool,
    pub error: Option<String>,
}

/// Plugin-managed state for shortcut registration.
pub struct ShortcutState {
    /// Sender to deliver the window identifier to the deferred BindShortcuts call.
    /// Consumed on the first `set_shortcut_window` call.
    pub window_tx: Mutex<Option<tokio::sync::oneshot::Sender<Option<ashpd::WindowIdentifier>>>>,
    /// Set true once `set_shortcut_window` has been called, preventing re-entry.
    pub window_provided: AtomicBool,
    /// Set true once the portal BindShortcuts call reports success.
    /// Always true on X11 (shortcuts are synchronously bound).
    pub binding_complete: AtomicBool,
    /// Owns the Wayland portal session and activation listener for process lifetime.
    /// Dropping it cancels the listener — must NOT be std::mem::forgot.
    pub wayland_handle: Mutex<Option<tauri_plugin_xdg_portal::global_shortcuts::ShortcutHandle>>,
    /// The shortcut string currently active on X11, used to restore it if an
    /// update to a new shortcut fails.
    pub current_x11_shortcut: Mutex<Option<String>>,
    /// Non-None once BindShortcuts has returned a failure. Used by the frontend
    /// race guard to detect a missed shortcut-binding-result error event.
    pub binding_error: Mutex<Option<String>>,
    /// Stored shortcut string for retry after failure.
    pub wayland_bind_shortcut: Mutex<Option<String>>,
    /// Stored activation callback for retry after failure.
    pub wayland_bind_on_activated: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

impl Default for ShortcutState {
    fn default() -> Self {
        Self {
            window_tx: Mutex::new(None),
            window_provided: AtomicBool::new(false),
            binding_complete: AtomicBool::new(false),
            wayland_handle: Mutex::new(None),
            current_x11_shortcut: Mutex::new(None),
            binding_error: Mutex::new(None),
            wayland_bind_shortcut: Mutex::new(None),
            wayland_bind_on_activated: Mutex::new(None),
        }
    }
}

pub trait DesktopIntegrationExt<R: Runtime> {
    /// Request the window manager to activate and focus the given window.
    /// On X11 this sets `_NET_WM_USER_TIME`; on Wayland this is a no-op
    /// (focus is compositor-controlled).
    fn request_desktop_activation_assist(
        &self,
        window: &WebviewWindow<R>,
        source: &'static str,
        label: &str,
    );

    /// Register a global shortcut. On X11 the shortcut is bound immediately
    /// via `tauri-plugin-global-shortcut`. On Wayland the portal session is
    /// created here and binding is deferred until `set_shortcut_window` is
    /// called.
    fn register_shortcut<F>(&self, shortcut: &str, on_activated: F)
    where
        F: Fn() + Send + Sync + 'static;

    /// Trigger the deferred Wayland portal `BindShortcuts` call. Call this
    /// when the first picker window becomes visible so the portal dialog has a
    /// context. No-op on X11 or after the first call.
    ///
    /// Emits `shortcut-binding-result` once binding resolves.
    fn set_shortcut_window(&self, window: &WebviewWindow<R>);

    /// Update the registered shortcut to a new key combination.
    /// On X11 the shortcut is re-registered immediately. On Wayland the
    /// portal session cannot be updated live — logs a warning instead.
    fn update_shortcut<F>(&self, shortcut: &str, on_activated: F)
    where
        F: Fn() + Send + Sync + 'static;

    /// Returns true if the global shortcut binding has completed.
    /// Always true on X11. On Wayland, true only after the portal BindShortcuts
    /// call succeeds.
    fn is_shortcut_binding_complete(&self) -> bool;

    /// Returns the binding error message if BindShortcuts failed, or None if
    /// still pending or successful. Used by the frontend race guard to detect a
    /// missed shortcut-binding-result error event.
    fn shortcut_binding_error(&self) -> Option<String>;
}

/// Returns true once the portal BindShortcuts call has completed successfully.
/// Exposed to the frontend so it can recover from the race where the backend
/// emitted shortcut-binding-result before the webview listener was registered.
#[tauri::command]
fn check_shortcut_binding_complete<R: Runtime>(app: tauri::AppHandle<R>) -> bool {
    app.is_shortcut_binding_complete()
}

/// Returns the binding error message if BindShortcuts failed, or null if still
/// pending or successful. Complements check_shortcut_binding_complete for the
/// race where the failure event fires before the webview listener is registered.
#[tauri::command]
fn check_shortcut_binding_error<R: Runtime>(app: tauri::AppHandle<R>) -> Option<String> {
    app.shortcut_binding_error()
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("desktop-integration")
        .invoke_handler(tauri::generate_handler![
            check_shortcut_binding_complete,
            check_shortcut_binding_error,
        ])
        .setup(|app, _api| {
            app.manage(ShortcutState::default());
            Ok(())
        })
        .build()
}

fn request_x11_user_time<R: Runtime>(window: &WebviewWindow<R>, source: &'static str, label: &str) {
    let gtk_window = match window.gtk_window() {
        Ok(w) => w,
        Err(error) => {
            info!("native X11 activation unavailable for {source} label={label}: {error}");
            return;
        }
    };

    let mut timestamp = gtk::current_event_time();
    let mut xid = None;

    if let Some(gdk_window) = gtk_window.window() {
        if let Ok(x11_window) = gdk_window.downcast::<gdkx11::X11Window>() {
            xid = Some(x11_window.xid());

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
}

fn is_wayland() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
}

impl<R: Runtime> DesktopIntegrationExt<R> for AppHandle<R> {
    fn request_desktop_activation_assist(
        &self,
        window: &WebviewWindow<R>,
        source: &'static str,
        label: &str,
    ) {
        let label = label.to_string();
        let window = window.clone();
        let window_for_run = window.clone();
        let fallback_label = label.clone();

        match window_for_run.run_on_main_thread(move || {
            request_x11_user_time(&window, source, &label);
        }) {
            Ok(()) => {}
            Err(error) => {
                info!(
                    "failed to schedule native X11 activation for {source} label={fallback_label}: {error}"
                );
            }
        }
    }

    fn register_shortcut<F>(&self, shortcut: &str, on_activated: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        let on_activated = Arc::new(on_activated);

        if is_wayland() {
            self.register_wayland_shortcut(shortcut, on_activated);
        } else {
            // X11 binds immediately — mark as complete now.
            self.state::<ShortcutState>()
                .binding_complete
                .store(true, Ordering::SeqCst);
            self.register_x11_shortcut(shortcut, on_activated);
        }
    }

    fn set_shortcut_window(&self, _window: &WebviewWindow<R>) {
        let state = self.state::<ShortcutState>();

        if state.window_provided.swap(true, Ordering::SeqCst) {
            return;
        }

        let tx = match state.window_tx.lock().ok().and_then(|mut g| g.take()) {
            Some(tx) => tx,
            None => return,
        };

        // Send None — the portal dialog will appear compositor-placed.
        // TODO: anchor the dialog to the window by exporting the wl_surface via
        // xdg-exported-v2 (requires gdk-wayland bindings or manual GDK C FFI).
        let _ = tx.send(None);
    }

    fn update_shortcut<F>(&self, shortcut: &str, on_activated: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        if is_wayland() {
            log::warn!(
                "Wayland shortcut change requires app restart to take effect (requested: {shortcut})"
            );
        } else {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;

            let previous = self
                .state::<ShortcutState>()
                .current_x11_shortcut
                .lock()
                .ok()
                .and_then(|g| g.clone());

            let on_activated = Arc::new(on_activated);

            let _ = self.global_shortcut().unregister_all();

            let oa_new = on_activated.clone();
            let result =
                self.global_shortcut()
                    .on_shortcut(shortcut, move |_app, _shortcut, event| {
                        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            oa_new();
                        }
                    });

            match result {
                Ok(()) => {
                    info!("X11 global shortcut updated to: {shortcut}");
                    if let Ok(mut g) = self.state::<ShortcutState>().current_x11_shortcut.lock() {
                        *g = Some(shortcut.to_string());
                    }
                }
                Err(e) => {
                    log::error!("failed to update X11 shortcut to {shortcut}: {e}");
                    // Attempt to restore the previous shortcut so the user isn't left
                    // with no active shortcut for the rest of the session.
                    if let Some(ref prev) = previous {
                        let oa_rollback = on_activated.clone();
                        let rollback = self.global_shortcut().on_shortcut(
                            prev.as_str(),
                            move |_app, _shortcut, event| {
                                if event.state
                                    == tauri_plugin_global_shortcut::ShortcutState::Pressed
                                {
                                    oa_rollback();
                                }
                            },
                        );
                        match rollback {
                            Ok(()) => info!("X11 shortcut rolled back to: {prev}"),
                            Err(e2) => log::error!(
                                "failed to restore previous shortcut {prev}: {e2}; \
                                 no shortcut active until app restart"
                            ),
                        }
                    }
                }
            }
        }
    }

    fn is_shortcut_binding_complete(&self) -> bool {
        self.state::<ShortcutState>()
            .binding_complete
            .load(Ordering::SeqCst)
    }

    fn shortcut_binding_error(&self) -> Option<String> {
        self.state::<ShortcutState>()
            .binding_error
            .lock()
            .ok()
            .and_then(|g| g.clone())
    }
}

/// Internal helpers — not part of the public trait.
trait DesktopIntegrationInternal<R: Runtime> {
    fn register_wayland_shortcut(&self, shortcut: &str, on_activated: Arc<dyn Fn() + Send + Sync>);

    fn register_x11_shortcut(&self, shortcut: &str, on_activated: Arc<dyn Fn() + Send + Sync>);

    /// Reset state and spawn a fresh binding task so the next `set_shortcut_window`
    /// call retries the portal BindShortcuts. No-op if retry params were never stored.
    fn schedule_wayland_bind_retry(&self);
}

/// Spawns the async task that drives the Wayland portal binding.
///
/// Creates a fresh oneshot channel, stores the sender in `ShortcutState`, resets
/// `window_provided` to false, then spawns the portal task with the receiver.
/// Called on first registration and after each binding failure to set up for retry.
fn spawn_wayland_bind_task<R: Runtime>(
    app: AppHandle<R>,
    shortcut: String,
    on_activated: Arc<dyn Fn() + Send + Sync>,
) {
    let (window_tx, window_rx) = tokio::sync::oneshot::channel();

    let state = app.state::<ShortcutState>();
    // Store the sender before resetting window_provided so a concurrent
    // set_shortcut_window that observes window_provided=false is guaranteed
    // to find a valid tx in the mutex.
    if let Ok(mut guard) = state.window_tx.lock() {
        *guard = Some(window_tx);
        state.window_provided.store(false, Ordering::SeqCst);
    }

    let app_for_result = app.clone();
    let on_binding_result = move |result: Result<(), String>| {
        let success = result.is_ok();
        let state = app_for_result.state::<ShortcutState>();
        if success {
            state.binding_complete.store(true, Ordering::SeqCst);
            // Clear any previous failure message so shortcut_binding_error() reflects
            // the current successful state after a retry.
            if let Ok(mut g) = state.binding_error.lock() {
                *g = None;
            }
        } else if let Some(msg) = result.as_ref().err() {
            if let Ok(mut g) = state.binding_error.lock() {
                *g = Some(msg.clone());
            }
            // Reset for retry: next set_shortcut_window will trigger a new attempt.
            app_for_result.schedule_wayland_bind_retry();
        }
        let payload = ShortcutBindingResult {
            success,
            error: result.err(),
        };
        app_for_result.emit("shortcut-binding-result", payload).ok();
    };

    tauri::async_runtime::spawn(async move {
        match tauri_plugin_xdg_portal::global_shortcuts::create_session(
            "emoji-nook-toggle",
            "Toggle Emoji Nook",
            Some(&shortcut),
            move || on_activated(),
            on_binding_result,
            window_rx,
        )
        .await
        {
            Ok(handle) => {
                // Keep the handle alive so the portal session and activation
                // listener remain active.  Dropping it would cancel the shortcut.
                if let Ok(mut guard) = app.state::<ShortcutState>().wayland_handle.lock() {
                    *guard = Some(handle);
                }
            }
            Err(e) => {
                log::error!("failed to create Wayland shortcut session: {e}");
                let error_str = e.to_string();
                if let Ok(mut g) = app.state::<ShortcutState>().binding_error.lock() {
                    *g = Some(error_str.clone());
                }
                // Set up for retry before emitting so the race guard sees the error.
                app.schedule_wayland_bind_retry();
                app.emit(
                    "shortcut-binding-result",
                    ShortcutBindingResult {
                        success: false,
                        error: Some(error_str),
                    },
                )
                .ok();
            }
        }
    });
}

impl<R: Runtime> DesktopIntegrationInternal<R> for AppHandle<R> {
    fn register_wayland_shortcut(&self, shortcut: &str, on_activated: Arc<dyn Fn() + Send + Sync>) {
        let shortcut = shortcut.to_string();

        // Store for use by schedule_wayland_bind_retry after a failure.
        if let Ok(mut g) = self.state::<ShortcutState>().wayland_bind_shortcut.lock() {
            *g = Some(shortcut.clone());
        }
        if let Ok(mut g) = self
            .state::<ShortcutState>()
            .wayland_bind_on_activated
            .lock()
        {
            *g = Some(Arc::clone(&on_activated));
        }

        spawn_wayland_bind_task(self.clone(), shortcut, on_activated);
    }

    fn register_x11_shortcut(&self, shortcut: &str, on_activated: Arc<dyn Fn() + Send + Sync>) {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;

        info!("registering global shortcut via X11: {shortcut}");
        let result = self
            .global_shortcut()
            .on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    on_activated();
                }
            });

        match result {
            Ok(()) => {
                info!("X11 global shortcut registered: {shortcut}");
                if let Ok(mut g) = self.state::<ShortcutState>().current_x11_shortcut.lock() {
                    *g = Some(shortcut.to_string());
                }
            }
            Err(e) => log::error!("failed to register X11 global shortcut: {e}"),
        }
    }

    fn schedule_wayland_bind_retry(&self) {
        let state = self.state::<ShortcutState>();
        let shortcut = state
            .wayland_bind_shortcut
            .lock()
            .ok()
            .and_then(|g| g.clone());
        let on_activated = state
            .wayland_bind_on_activated
            .lock()
            .ok()
            .and_then(|g| g.clone());
        if let (Some(shortcut), Some(on_activated)) = (shortcut, on_activated) {
            spawn_wayland_bind_task(self.clone(), shortcut, on_activated);
        }
    }
}
