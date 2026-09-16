// Root view that mounts the emoji picker inside the compact shell
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { desktopIntegration } from '@liminal-hq/plugin-desktop-integration';
import type { ShortcutChangedPayload } from '@liminal-hq/plugin-desktop-integration';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import PickerShell from './components/PickerShell';
import EmojiPickerPanel from './components/EmojiPickerPanel';
import SettingsPanel from './components/SettingsPanel';
import type { EmojiSelection } from './components/EmojiPickerPanel';
import { useTheme } from './hooks/useTheme';
import { useSettings } from './hooks/useSettings';
import type { Settings } from './hooks/useSettings';
import './App.css';

// Process-lifetime (not persisted) bookkeeping for the Wayland external-rebind sync
// below — backed by Rust-side app state that survives a picker webview being
// recreated on every show, but resets on every app restart, unlike the settings
// store, so a stale value from a previous run can't suppress reconciliation with a
// freshly created portal session.
function getLastSyncedExternalTrigger(): Promise<string | null> {
	return invoke<string | null>('get_last_synced_external_trigger');
}

function setLastSyncedExternalTrigger(trigger: string): Promise<void> {
	return invoke('set_last_synced_external_trigger', { trigger });
}

const XDG_MODIFIER_TO_TAURI: Record<string, string> = {
	Ctrl: 'Ctrl',
	Alt: 'Alt',
	Shift: 'Shift',
	Super: 'Super',
};

/**
 * Best-effort parse of the GTK/XKB accelerator syntax embedded in the
 * GlobalShortcuts portal's trigger_description, back into this app's own
 * accelerator format ("Alt+Shift+E"). trigger_description is documented as
 * user-readable text describing *how to trigger* the shortcut, not a bare
 * machine-parseable value — confirmed live on GNOME, it's literally
 * "Press <Super>e" (an instructional phrase with the same syntax
 * `to_xdg_trigger`, tauri-plugin-xdg-portal, produces going the other
 * direction, embedded in it), not just "<Super>e" alone. Searches for that
 * embedded syntax anywhere in the string rather than assuming the whole
 * string is one, since the surrounding wording isn't guaranteed (a different
 * compositor, or a different system language, could phrase it differently).
 * The key token matches either a run of two or more letters/digits/underscores
 * (named keysyms — Return, BackSpace, F1, space, plus, and underscored
 * multi-word names like KP_Add or ISO_Left_Tab) or exactly one arbitrary
 * character (single-character keysyms, which this app's own shortcut capture
 * allows to be any key including punctuation, e.g. "Alt+."). Preferring the
 * longer run first means a single-character key followed by trailing prose
 * punctuation (e.g. a closing parenthesis or full stop) stops at that one
 * character instead of folding the punctuation into the key, while a single
 * punctuation character on its own is still accepted as a real key.
 * Returns null rather than guessing when no such substring is found — the
 * caller must not persist a value that fails to parse as this app's own
 * `shortcut` setting, since that also gets fed back into re-registration on
 * next launch. The outer match captures *any* `<word>` tag run (not just
 * recognised modifiers), and every tag in it is then validated below —
 * rejecting the whole accelerator if any single tag isn't one of
 * Ctrl/Alt/Shift/Super, in any position. A narrower match that only matched
 * recognised modifiers would still find a match starting after an
 * unsupported one (e.g. GTK's portable "<Primary>", or "<Hyper>", neither
 * representable in this app's own accelerator format), silently dropping it
 * instead of rejecting the accelerator; a trailing or embedded unsupported
 * modifier is worse still, since it isn't matched as a tag at all and its
 * leading `<` gets read as the key itself.
 */
function parseXdgTrigger(trigger: string): string | null {
	const accelerator = trigger.match(/(?:<\w+>)+(?:[A-Za-z0-9_]{2,}|\S)/);
	if (!accelerator) return null;

	const tagPattern = /<(\w+)>/g;
	const parts: string[] = [];
	let rest = accelerator[0];
	let consumed = 0;
	for (let match = tagPattern.exec(rest); match; match = tagPattern.exec(rest)) {
		const modifier = XDG_MODIFIER_TO_TAURI[match[1]];
		if (!modifier) return null;
		parts.push(modifier);
		consumed = tagPattern.lastIndex;
	}
	rest = rest.slice(consumed);
	if (parts.length === 0 || rest.length === 0) return null;
	// A leftover bare "<" or ">" means the accelerator was truncated or malformed
	// (e.g. an unclosed tag) rather than a real key — reject instead of persisting
	// the stray bracket itself as the key.
	if (rest === '<' || rest === '>') return null;

	let key = rest;
	if (key === 'space') key = 'Space';
	else if (key === 'plus') key = '+';
	else if (key.length === 1) key = key.toUpperCase();
	// else: preserve named-key casing as-is (Tab, Return, F1, Left, BackSpace, …)

	parts.push(key);
	return parts.join('+');
}

function formatBindError(err: string): { headline: string; hint: string } {
	// ashpd PortalError::Other means the portal rejected the request — on GNOME this
	// happens when the process cgroup doesn't match the app bundle ID, which occurs
	// when the app is launched from a terminal instead of an application launcher.
	if (err.includes('Portal request')) {
		return {
			headline: 'The desktop portal rejected the shortcut request.',
			hint: 'Launch the app from your Activities launcher (not a terminal) so the desktop can identify it by its bundle ID.',
		};
	}
	return { headline: err, hint: '' };
}

function App() {
	useTheme();
	const { settings, loaded, update } = useSettings();
	const rawView = new URLSearchParams(window.location.search).get('view');
	const initialView: 'picker' | 'settings' | 'shortcut-setup' =
		rawView === 'shortcut-setup'
			? 'shortcut-setup'
			: rawView === 'settings'
				? 'settings'
				: 'picker';
	const [view, setView] = useState<'picker' | 'settings' | 'shortcut-setup'>(initialView);
	const [bindError, setBindError] = useState<string | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const isDraggingRef = useRef(false);
	const settingsRef = useRef(settings);
	useEffect(() => {
		settingsRef.current = settings;
	}, [settings]);

	const handleSelect = useCallback(
		(selection: EmojiSelection) => {
			invoke('insert_emoji', {
				emoji: selection.emoji,
				label: selection.label,
				closeOnSelect: settings.closeOnSelect,
			}).catch((err) => console.error('insert_emoji IPC failed:', err));
		},
		[settings.closeOnSelect],
	);

	// Reset picker state when shown via global shortcut
	useEffect(() => {
		const unlisten = listen('picker-shown', () => {
			setView('picker');
			searchRef.current?.focus();
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// On Wayland, wait for portal shortcut binding to complete before showing picker.
	useEffect(() => {
		if (view !== 'shortcut-setup') return;
		let cancelled = false;
		const unlistenPromise = listen<{ success: boolean; error: string | null }>(
			'shortcut-binding-result',
			({ payload }) => {
				if (payload.success) {
					setView('picker');
				} else {
					setBindError(payload.error ?? 'Could not bind the global shortcut.');
				}
			},
		).then((fn) => {
			// Guard against the race where the backend emitted shortcut-binding-result
			// before this webview subscribed — check both success and failure states.
			if (!cancelled) {
				desktopIntegration
					.checkShortcutBindingComplete()
					.then((complete) => {
						if (!cancelled && complete) setView('picker');
					})
					.catch(() => {});
				desktopIntegration
					.checkShortcutBindingError()
					.then((err) => {
						if (!cancelled && err) setBindError(err);
					})
					.catch(() => {});
			}
			return fn;
		});
		return () => {
			cancelled = true;
			unlistenPromise.then((fn) => fn());
		};
	}, [view]);

	// Wayland only: keep the stored shortcut in sync if the compositor's own settings
	// UI rebinds it externally (e.g. GNOME Settings → Apps → Emoji Nook → Global
	// Shortcuts) instead of through this app's own Settings dialog. Confirmed live on
	// GNOME: the portal's trigger_description is instructional text with GTK/XKB
	// accelerator syntax embedded in it (e.g. "Press <Alt><Shift>e"), not the nicely
	// formatted text GNOME Settings' own UI shows for the same shortcut —
	// parseXdgTrigger extracts and translates the embedded syntax back to this app's
	// own format, or returns null (leaving the stored value untouched) if it can't
	// find any.
	//
	// Gated on `loaded`: until the real persisted settings have finished loading,
	// `settings` is still the DEFAULTS placeholder, and persisting `{ ...settings,
	// shortcut }` at that point would overwrite the user's actual skin tone,
	// close-on-select, and autostart preferences with those defaults.
	//
	// Depends only on `loaded`/`update` (not `settings`) so it attaches exactly once
	// per mount, reading `settingsRef.current` for the latest values instead.
	//
	// `lastSyncedExternalTrigger` — a raw-trigger-string value held in Rust-side
	// app state for this process's lifetime, not React state or the settings
	// store — records what the missed-event catch-up check below has already acted
	// on, so it can tell a genuinely new external rebind apart from the same stale
	// plugin-cache value that keeps coming back on every fresh picker mount (the
	// picker window, and this whole component tree, is recreated on every show;
	// the plugin never clears its cache once read). Scoped to the process, not
	// persisted to disk, so a stale value from a previous run can't suppress
	// reconciliation with a freshly created portal session after an app restart.
	// Deliberately applied ONLY to the catch-up path, not the live listener: a live
	// `shortcut-changed` event always represents a rebind that just happened, even
	// if its raw text happens to match an earlier catch-up value (e.g. the user
	// rebound to A, edited locally to B, then rebound externally back to A) —
	// deduplicating that against history would wrongly discard it and leave the
	// stale local edit in place.
	useEffect(() => {
		if (!loaded) return;
		let cancelled = false;

		// Marks the trigger consumed only *after* the shortcut save succeeds — the
		// reverse order would risk the marker persisting while the shortcut never
		// actually got saved (the picker window closing mid-chain, or the save
		// itself failing), which would then permanently skip that trigger on every
		// future catch-up check even though the real shortcut was never updated.
		function applyTrigger(trigger: string) {
			const shortcut = parseXdgTrigger(trigger);
			if (!shortcut) {
				console.warn('unrecognised external shortcut trigger:', trigger);
				return Promise.resolve();
			}
			if (cancelled) return Promise.resolve();
			return update({ ...settingsRef.current, shortcut }).then(() => {
				if (cancelled) return;
				return setLastSyncedExternalTrigger(trigger);
			});
		}

		const unlistenPromise = listen<ShortcutChangedPayload>('shortcut-changed', ({ payload }) => {
			applyTrigger(payload.triggerDescription).catch((err) =>
				console.error('settings save failed after external shortcut rebind:', err),
			);
		}).then((fn) => {
			// Guard against the race where the rebind happened before this webview
			// subscribed — check once for a trigger the event listener would have missed.
			if (!cancelled) {
				desktopIntegration
					.checkShortcutTriggerDescription()
					.then((trigger) => {
						if (cancelled || !trigger) return;
						return getLastSyncedExternalTrigger().then((lastSynced) => {
							if (cancelled || trigger === lastSynced) return;
							return applyTrigger(trigger);
						});
					})
					.catch((err) =>
						console.error('settings save failed after external shortcut rebind:', err),
					);
			}
			return fn;
		});
		return () => {
			cancelled = true;
			unlistenPromise.then((fn) => fn());
		};
	}, [loaded, update]);

	// Esc key hides the picker (or closes settings). Blocked during shortcut-setup
	// while waiting for portal approval; allowed once an error is shown.
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				if (view === 'settings') {
					setView('picker');
				} else if (view === 'shortcut-setup' && bindError === null) {
					// Suppress — portal dialog is open, dismissing would strand the user.
				} else {
					invoke('hide_picker').catch((err) => console.error('hide_picker IPC failed:', err));
				}
			}
		}
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [view, bindError]);

	// On Wayland the compositor consumes all mouse events during an interactive
	// move, so mouseup never fires inside the webview.  Instead, we arm a
	// one-shot mousemove listener 100 ms after the drag starts — webview
	// mousemove events stop while the compositor owns the drag and resume the
	// instant it ends, so the first post-drag mousemove clears the flag.
	// mouseup still handles quick clicks on drag regions that don't move the window.
	useEffect(() => {
		let armTimer: ReturnType<typeof setTimeout> | null = null;

		function clearDrag() {
			isDraggingRef.current = false;
		}

		function onMouseDown(e: MouseEvent) {
			if ((e.target as HTMLElement).closest('[data-tauri-drag-region]')) {
				isDraggingRef.current = true;
				if (armTimer) {
					clearTimeout(armTimer);
				} else {
					// armTimer already fired — clear any orphaned one-shot listener so
					// it cannot fire during the next drag before the compositor takes over.
					document.removeEventListener('mousemove', clearDrag, true);
				}
				armTimer = setTimeout(() => {
					armTimer = null;
					document.addEventListener('mousemove', clearDrag, {
						once: true,
						capture: true,
					});
				}, 100);
			}
		}

		function onMouseUp() {
			if (armTimer) {
				clearTimeout(armTimer);
				armTimer = null;
			}
			// Remove any one-shot listener the arm timer may have already registered.
			document.removeEventListener('mousemove', clearDrag, true);
			isDraggingRef.current = false;
		}

		document.addEventListener('mousedown', onMouseDown, true);
		document.addEventListener('mouseup', onMouseUp, true);

		return () => {
			document.removeEventListener('mousedown', onMouseDown, true);
			document.removeEventListener('mouseup', onMouseUp, true);
			document.removeEventListener('mousemove', clearDrag, true);
			if (armTimer) clearTimeout(armTimer);
		};
	}, []);

	// Suppressed while settings or shortcut-setup is open — native dropdowns, shortcut
	// capture, and the portal dialog all trigger blur events that would dismiss the window.
	// isDraggingRef guards against blur fired by the compositor during window move.
	// Once a bind error is shown, blur-dismiss is re-enabled so the window can be dismissed.
	useEffect(() => {
		if (view === 'settings') return;
		if (view === 'shortcut-setup' && bindError === null) return;

		let active = true;
		const appWindow = getCurrentWebviewWindow();

		const hide = () => {
			if (!isDraggingRef.current) {
				invoke('hide_picker').catch((err) => console.error('hide_picker IPC failed:', err));
			}
		};

		const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
			if (!focused) hide();
		});

		// onFocusChanged is edge-triggered. If the window is already unfocused when
		// this effect runs (e.g. compositor did not restore focus after portal dialog),
		// no event fires and the picker would stay open forever without this check.
		// Guard with `active` so a stale promise from a previous effect run cannot
		// call hide() after this effect has cleaned up.
		appWindow
			.isFocused()
			.then((focused) => {
				if (active && !focused) hide();
			})
			.catch(() => {});

		return () => {
			active = false;
			unlisten.then((fn) => fn());
		};
	}, [view, bindError]);

	const handleSettingsSave = useCallback(
		async (next: Settings) => {
			await update(next).catch((err) => console.error('settings save failed:', err));
			setView('picker');
		},
		[update],
	);

	return (
		<main className="app-root">
			<PickerShell>
				{view === 'shortcut-setup' ? (
					<div className="shortcut-setup">
						{bindError === null ? (
							<>
								<p className="shortcut-setup__message">Setting up keyboard shortcut…</p>
								<p className="shortcut-setup__hint">
									Approve the permission request from your desktop to enable the global shortcut.
								</p>
							</>
						) : (
							<>
								<p className="shortcut-setup__message shortcut-setup__message--error">
									Shortcut setup failed
								</p>
								{(() => {
									const { headline, hint } = formatBindError(bindError);
									return (
										<>
											<p className="shortcut-setup__hint">{headline}</p>
											{hint && <p className="shortcut-setup__hint">{hint}</p>}
										</>
									);
								})()}
								<button
									className="shortcut-setup__dismiss"
									onClick={() =>
										invoke('hide_picker').catch((err) =>
											console.error('hide_picker IPC failed:', err),
										)
									}
								>
									Dismiss
								</button>
							</>
						)}
					</div>
				) : view === 'picker' ? (
					<EmojiPickerPanel
						searchRef={searchRef}
						skinTone={settings.skinTone}
						onSkinToneChange={(skinTone) => update({ ...settings, skinTone })}
						onEmojiSelect={handleSelect}
						onOpenSettings={() => setView('settings')}
					/>
				) : loaded ? (
					<SettingsPanel
						settings={settings}
						onSave={handleSettingsSave}
						onCancel={() => setView('picker')}
					/>
				) : null}
			</PickerShell>
		</main>
	);
}

export default App;
