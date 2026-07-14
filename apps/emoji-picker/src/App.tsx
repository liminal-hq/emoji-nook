// Root view that mounts the emoji picker inside the compact shell
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { desktopIntegration } from '@liminal-hq/plugin-desktop-integration';
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
