// Root view that mounts the emoji picker inside the compact shell
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useState, useCallback, useEffect, useRef } from 'react';
import type { SkinTone } from 'frimousse';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import PickerShell from './components/PickerShell';
import EmojiPickerPanel from './components/EmojiPickerPanel';
import type { EmojiSelection } from './components/EmojiPickerPanel';
import { useTheme } from './hooks/useTheme';
import './App.css';

function App() {
	useTheme();
	const [skinTone, setSkinTone] = useState<SkinTone>('none');
	const searchRef = useRef<HTMLInputElement>(null);

	const handleSelect = useCallback((selection: EmojiSelection) => {
		invoke('insert_emoji', {
			emoji: selection.emoji,
			label: selection.label,
		}).catch((err) => console.error('insert_emoji IPC failed:', err));
	}, []);

	// Reset picker state when shown via global shortcut
	useEffect(() => {
		const unlisten = listen('picker-shown', () => {
			searchRef.current?.focus();
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// Esc key hides the picker
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				invoke('hide_picker').catch((err) =>
					console.error('hide_picker IPC failed:', err),
				);
			}
		}
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);

	// Click-outside (window blur) hides the picker
	useEffect(() => {
		const appWindow = getCurrentWebviewWindow();
		const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
			if (!focused) {
				invoke('hide_picker').catch((err) =>
					console.error('hide_picker IPC failed:', err),
				);
			}
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	return (
		<main className="app-root">
			<PickerShell>
				<EmojiPickerPanel
					searchRef={searchRef}
					skinTone={skinTone}
					onSkinToneChange={setSkinTone}
					onEmojiSelect={handleSelect}
				/>
			</PickerShell>
		</main>
	);
}

export default App;
