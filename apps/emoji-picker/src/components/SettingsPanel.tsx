// Settings panel for configuring shortcut, skin tone, close-on-select, and autostart
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useState, useCallback } from 'react';
import type { SkinTone } from 'frimousse';
import { invoke } from '@tauri-apps/api/core';
import { isEnabled, enable, disable } from '@tauri-apps/plugin-autostart';
import type { Settings } from '../hooks/useSettings';

const SKIN_TONES: { value: SkinTone; label: string; preview: string }[] = [
	{ value: 'none', label: 'Default', preview: '👋' },
	{ value: 'light', label: 'Light', preview: '👋🏻' },
	{ value: 'medium-light', label: 'Medium Light', preview: '👋🏼' },
	{ value: 'medium', label: 'Medium', preview: '👋🏽' },
	{ value: 'medium-dark', label: 'Medium Dark', preview: '👋🏾' },
	{ value: 'dark', label: 'Dark', preview: '👋🏿' },
];

interface SettingsPanelProps {
	settings: Settings;
	onSave: (settings: Settings) => void | Promise<void>;
	onCancel: () => void;
}

// W3C UI Events key names that differ from XKB/Tauri accelerator names.
const W3C_TO_TAURI: Record<string, string> = {
	Enter: 'Return',
	Backspace: 'BackSpace',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	PageUp: 'Prior',
	PageDown: 'Next',
};

export default function SettingsPanel({ settings, onSave, onCancel }: SettingsPanelProps) {
	const [draft, setDraft] = useState<Settings>(settings);
	const [capturing, setCapturing] = useState(false);

	const handleShortcutCapture = useCallback(
		(e: React.KeyboardEvent) => {
			if (!capturing) return;
			e.preventDefault();
			e.stopPropagation();

			// Escape cancels capture without recording the key.
			if (e.key === 'Escape') {
				setCapturing(false);
				return;
			}

			// Ignore lone modifier presses.
			if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

			const parts: string[] = [];
			if (e.ctrlKey) parts.push('Ctrl');
			if (e.altKey) parts.push('Alt');
			if (e.shiftKey) parts.push('Shift');
			if (e.metaKey) parts.push('Super');

			// Require at least one modifier — bare keys would intercept system-wide
			// input and are not useful as app shortcuts.
			if (parts.length === 0) return;

			// Translate W3C UI Events key names to XKB/Tauri accelerator names.
			let key = W3C_TO_TAURI[e.key] ?? e.key;
			if (key === ' ') key = 'Space';
			else if (key.length === 1) key = key.toUpperCase();
			parts.push(key);

			setDraft((d) => ({ ...d, shortcut: parts.join('+') }));
			setCapturing(false);
		},
		[capturing],
	);

	const handleSave = useCallback(async () => {
		// Apply autostart change
		try {
			const currentlyEnabled = await isEnabled();
			if (draft.autostart && !currentlyEnabled) {
				await enable();
			} else if (!draft.autostart && currentlyEnabled) {
				await disable();
			}
		} catch (err) {
			console.error('autostart toggle failed:', err);
		}

		// Tell Rust to re-register the shortcut if it changed
		if (draft.shortcut !== settings.shortcut) {
			invoke('update_shortcut', { shortcut: draft.shortcut }).catch((err) =>
				console.error('update_shortcut failed:', err),
			);
		}

		await onSave(draft);
	}, [draft, settings.shortcut, onSave]);

	return (
		<div className="settings-panel">
			<div className="settings-header">
				<span className="settings-title">Settings</span>
			</div>

			<div className="settings-body">
				<label className="settings-row">
					<span className="settings-label">Shortcut</span>
					<button
						className={`settings-shortcut-btn${capturing ? ' capturing' : ''}`}
						onClick={() => setCapturing(true)}
						onKeyDown={handleShortcutCapture}
						onBlur={() => setCapturing(false)}
					>
						{capturing ? 'Press keys…' : draft.shortcut}
					</button>
				</label>

				<label className="settings-row">
					<span className="settings-label">Skin tone</span>
					<select
						className="settings-select"
						value={draft.skinTone}
						onChange={(e) =>
							setDraft((d) => ({
								...d,
								skinTone: e.target.value as SkinTone,
							}))
						}
					>
						{SKIN_TONES.map((st) => (
							<option key={st.value} value={st.value}>
								{st.preview} {st.label}
							</option>
						))}
					</select>
				</label>

				<label className="settings-row">
					<span className="settings-label">Close after selection</span>
					<input
						type="checkbox"
						className="settings-checkbox"
						checked={draft.closeOnSelect}
						onChange={(e) => setDraft((d) => ({ ...d, closeOnSelect: e.target.checked }))}
					/>
				</label>

				<label className="settings-row">
					<span className="settings-label">Start on login</span>
					<input
						type="checkbox"
						className="settings-checkbox"
						checked={draft.autostart}
						onChange={(e) => setDraft((d) => ({ ...d, autostart: e.target.checked }))}
					/>
				</label>
			</div>

			<div className="settings-actions">
				<button className="settings-btn settings-btn-cancel" onClick={onCancel}>
					Cancel
				</button>
				<button className="settings-btn settings-btn-save" onClick={handleSave}>
					Save
				</button>
			</div>
		</div>
	);
}
