// Implements the GlobalShortcuts portal for Wayland shortcut registration
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use crate::error::PortalError;
use ashpd::WindowIdentifier;
use futures_util::StreamExt;
use log::{error, info, warn};

/// Translates a Tauri-style shortcut string (e.g. `"Alt+Shift+E"`) into the
/// GTK/libxkbcommon accelerator format expected by the portal (`"<Alt><Shift>e"`).
fn to_xdg_trigger(shortcut: &str) -> String {
    let mut result = String::new();
    let mut key = String::new();

    for part in shortcut.split('+') {
        match part {
            "Alt" => result.push_str("<Alt>"),
            "Shift" => result.push_str("<Shift>"),
            "Ctrl" | "Control" => result.push_str("<Ctrl>"),
            "Super" | "Meta" => result.push_str("<Super>"),
            // XKB keysym names are case-sensitive: single-character keys use lowercase,
            // "space" is lowercase, but named keys (Tab, Return, F1, Left, …) must
            // preserve their original casing.
            "Space" => key = "space".to_string(),
            other => {
                key = if other.len() == 1 {
                    other.to_lowercase()
                } else {
                    other.to_string()
                };
            }
        }
    }

    result.push_str(&key);
    result
}

/// Creates a GlobalShortcuts portal session.
///
/// `window_rx` must deliver the `WindowIdentifier` for the parent window once
/// it becomes available — the portal's `BindShortcuts` call is deferred until
/// then.  Send `None` to bind without a parent window (portal dialog will be
/// unanchored).
///
/// `on_binding_result` is called once binding completes (or fails).
/// `on_activated` is called each time the shortcut fires.
///
/// Returns a `ShortcutHandle`; dropping it cancels the listener and closes the
/// portal session.
pub async fn create_session<F, B>(
    shortcut_id: &str,
    description: &str,
    preferred_trigger: Option<&str>,
    on_activated: F,
    on_binding_result: B,
    window_rx: tokio::sync::oneshot::Receiver<Option<WindowIdentifier>>,
) -> Result<ShortcutHandle, PortalError>
where
    F: Fn() + Send + 'static,
    B: Fn(Result<(), String>) + Send + 'static,
{
    use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};

    let portal = GlobalShortcuts::new().await.map_err(|e| {
        PortalError::Internal(format!("failed to connect to GlobalShortcuts portal: {e}"))
    })?;

    let session = portal.create_session().await.map_err(|e| {
        PortalError::Internal(format!("failed to create GlobalShortcuts session: {e}"))
    })?;

    let trigger_xdg = preferred_trigger.map(to_xdg_trigger);
    let shortcut = {
        let s = NewShortcut::new(shortcut_id, description);
        if let Some(ref t) = trigger_xdg {
            s.preferred_trigger(t.as_str())
        } else {
            s
        }
    };

    let activated_stream = portal
        .receive_activated()
        .await
        .map_err(|e| PortalError::Internal(format!("failed to subscribe to activations: {e}")))?;

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let sid = shortcut_id.to_string();

    tokio::spawn(async move {
        // Keep portal and session alive for the lifetime of this task.
        let _portal = portal;
        let _session = session;

        // Wait for the window identifier before binding.
        let window_id = tokio::select! {
            result = window_rx => match result {
                Ok(id) => id.unwrap_or_default(),
                // Sender dropped without a send (e.g. plugin teardown before first window).
                Err(_) => {
                    warn!("shortcut window sender dropped; aborting portal binding");
                    return;
                }
            },
            _ = &mut cancel_rx => return,
        };

        let bind_result = _portal
            .bind_shortcuts(&_session, &[shortcut], &window_id)
            .await;

        match bind_result {
            Ok(request) => match request.response() {
                Ok(resp) => {
                    if resp.shortcuts().is_empty() {
                        warn!(
                            "portal bind succeeded but returned no shortcuts — \
                             the key combination may already be claimed"
                        );
                        on_binding_result(
                            Err("compositor returned no bound shortcuts".to_string()),
                        );
                        return;
                    }
                    info!(
                        "global shortcuts bound: {:?}",
                        resp.shortcuts().iter().map(|s| s.id()).collect::<Vec<_>>()
                    );
                    on_binding_result(Ok(()));
                }
                Err(e) => {
                    error!("bind_shortcuts portal response error: {e}");
                    on_binding_result(Err(e.to_string()));
                    return;
                }
            },
            Err(e) => {
                error!("bind_shortcuts D-Bus call failed: {e}");
                on_binding_result(Err(e.to_string()));
                return;
            }
        }

        tokio::pin!(activated_stream);
        loop {
            tokio::select! {
                event = activated_stream.next() => {
                    match event {
                        Some(event) => {
                            if event.shortcut_id() == sid {
                                info!("global shortcut activated: {}", sid);
                                on_activated();
                            }
                        }
                        // Stream closed (compositor crash, D-Bus drop) — exit cleanly.
                        None => {
                            warn!("global shortcut activation stream ended for: {}", sid);
                            break;
                        }
                    }
                }
                _ = &mut cancel_rx => {
                    info!("global shortcut listener cancelled for: {}", sid);
                    break;
                }
            }
        }
    });

    Ok(ShortcutHandle { _cancel: cancel_tx })
}

/// Dropping this handle cancels the shortcut listener and closes the portal session.
pub struct ShortcutHandle {
    _cancel: tokio::sync::oneshot::Sender<()>,
}

#[cfg(test)]
mod tests {
    use super::to_xdg_trigger;

    #[test]
    fn translates_single_char_keys_to_lowercase() {
        assert_eq!(to_xdg_trigger("Alt+Shift+E"), "<Alt><Shift>e");
        assert_eq!(to_xdg_trigger("Ctrl+Space"), "<Ctrl>space");
        assert_eq!(to_xdg_trigger("Super+."), "<Super>.");
    }

    #[test]
    fn preserves_named_key_case() {
        assert_eq!(to_xdg_trigger("Alt+Tab"), "<Alt>Tab");
        assert_eq!(to_xdg_trigger("Ctrl+Return"), "<Ctrl>Return");
        assert_eq!(to_xdg_trigger("Alt+F1"), "<Alt>F1");
        assert_eq!(to_xdg_trigger("Ctrl+Left"), "<Ctrl>Left");
        assert_eq!(to_xdg_trigger("Shift+BackSpace"), "<Shift>BackSpace");
    }
}
