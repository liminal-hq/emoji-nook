// Implements the GlobalShortcuts portal for Wayland shortcut registration
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use crate::error::PortalError;
use futures_util::StreamExt;
use tracing::info;

/// Spawns a long-lived task that creates a GlobalShortcuts session, binds
/// the given shortcut, and listens for activation signals. On each activation,
/// the provided callback is invoked.
///
/// Returns a handle that keeps the session alive; dropping it tears everything down.
pub async fn listen_for_shortcut<F>(
    shortcut_id: &str,
    description: &str,
    preferred_trigger: Option<&str>,
    on_activated: F,
) -> Result<ShortcutHandle, PortalError>
where
    F: Fn() + Send + 'static,
{
    use ashpd::desktop::global_shortcuts::{GlobalShortcuts, NewShortcut};
    use ashpd::WindowIdentifier;

    let portal = GlobalShortcuts::new()
        .await
        .map_err(|e| PortalError::Internal(format!("failed to connect to GlobalShortcuts portal: {e}")))?;

    let session = portal
        .create_session()
        .await
        .map_err(|e| PortalError::Internal(format!("failed to create GlobalShortcuts session: {e}")))?;

    let mut shortcut = NewShortcut::new(shortcut_id, description);
    if let Some(trigger) = preferred_trigger {
        shortcut = shortcut.preferred_trigger(trigger);
    }

    let request = portal
        .bind_shortcuts(&session, &[shortcut], &WindowIdentifier::default())
        .await
        .map_err(|e| PortalError::Internal(format!("failed to bind shortcuts: {e}")))?;

    let response = request
        .response()
        .map_err(|e| PortalError::Internal(format!("bind shortcuts response error: {e}")))?;

    info!(
        "global shortcuts bound: {:?}",
        response
            .shortcuts()
            .iter()
            .map(|s| s.id())
            .collect::<Vec<_>>()
    );

    let activated_stream = portal
        .receive_activated()
        .await
        .map_err(|e| PortalError::Internal(format!("failed to listen for activations: {e}")))?;

    let sid = shortcut_id.to_string();
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        // Keep session alive for the lifetime of this task
        let _session = session;
        tokio::pin!(activated_stream);
        loop {
            tokio::select! {
                Some(event) = activated_stream.next() => {
                    if event.shortcut_id() == sid {
                        info!("global shortcut activated: {}", sid);
                        on_activated();
                    }
                }
                _ = &mut cancel_rx => {
                    info!("global shortcut listener cancelled for: {}", sid);
                    break;
                }
            }
        }
    });

    Ok(ShortcutHandle {
        _cancel: cancel_tx,
    })
}

/// Dropping this handle cancels the shortcut listener and closes the portal session.
pub struct ShortcutHandle {
    _cancel: tokio::sync::oneshot::Sender<()>,
}
