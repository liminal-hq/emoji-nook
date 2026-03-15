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

	const handleSelect = useCallback(
		(selection: EmojiSelection) => {
			invoke('insert_emoji', {
				emoji: selection.emoji,
				label: selection.label,
			}).catch((err) => console.error('insert_emoji IPC failed:', err));

			// If close-on-select is disabled, re-show the picker after the
			// injection has had time to paste into the target app. The Rust
			// side hides the window and sleeps ~300ms before simulating
			// Ctrl+V, so we wait long enough for that to land.
			if (!settings.closeOnSelect) {
				setTimeout(() => {
					invoke('show_picker').catch(() => {});
				}, 600);
			}
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

	// Click-outside (window blur) hides the picker.
	// Suppressed while settings is open — native dropdowns and shortcut
	// capture trigger blur events that would dismiss the window.
	useEffect(() => {
		if (view === 'settings') return;

		const appWindow = getCurrentWebviewWindow();
		const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
			if (!focused) {
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
