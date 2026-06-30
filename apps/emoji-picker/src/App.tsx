// Root view that mounts the emoji picker inside the compact shell
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
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

function App() {
	useTheme();
	const { settings, update } = useSettings();
	const [view, setView] = useState<'picker' | 'settings'>('picker');
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

	// Esc key hides the picker (or closes settings)
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				if (view === 'settings') {
					setView('picker');
				} else {
					invoke('hide_picker').catch((err) => console.error('hide_picker IPC failed:', err));
				}
			}
		}
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [view]);

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
				if (armTimer) clearTimeout(armTimer);
				armTimer = setTimeout(() => {
					document.addEventListener('mousemove', clearDrag, {
						once: true,
						capture: true,
					});
				}, 100);
			}
		}

		function onMouseUp() {
			if (armTimer) clearTimeout(armTimer);
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

	// Suppressed while settings is open — native dropdowns and shortcut
	// capture trigger blur events that would dismiss the window.
	// isDraggingRef guards against blur fired by the compositor during window move.
	useEffect(() => {
		if (view === 'settings') return;

		const appWindow = getCurrentWebviewWindow();
		const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
			if (!focused && !isDraggingRef.current) {
				invoke('hide_picker').catch((err) => console.error('hide_picker IPC failed:', err));
			}
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [view]);

	const handleSettingsSave = useCallback(
		(next: Settings) => {
			update(next);
			setView('picker');
		},
		[update],
	);

	return (
		<main className="app-root">
			<PickerShell>
				{view === 'picker' ? (
					<EmojiPickerPanel
						searchRef={searchRef}
						skinTone={settings.skinTone}
						onSkinToneChange={(skinTone) => update({ ...settings, skinTone })}
						onEmojiSelect={handleSelect}
						onOpenSettings={() => setView('settings')}
					/>
				) : (
					<SettingsPanel
						settings={settings}
						onSave={handleSettingsSave}
						onCancel={() => setView('picker')}
					/>
				)}
			</PickerShell>
		</main>
	);
}

export default App;
