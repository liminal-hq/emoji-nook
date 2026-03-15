// Settings panel for configuring shortcut, skin tone, close-on-select, and autostart
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useState, useEffect, useCallback } from 'react';
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
	onSave: (settings: Settings) => void;
	onCancel: () => void;
}

export default function SettingsPanel({ settings, onSave, onCancel }: SettingsPanelProps) {
	const [draft, setDraft] = useState<Settings>(settings);
	const [capturing, setCapturing] = useState(false);

	useEffect(() => {
		setDraft(settings);
	}, [settings]);

	const handleShortcutCapture = useCallback(
		(e: React.KeyboardEvent) => {
			if (!capturing) return;
			e.preventDefault();
			e.stopPropagation();

			// Ignore lone modifier presses
			if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

			const parts: string[] = [];
			if (e.ctrlKey) parts.push('Ctrl');
			if (e.altKey) parts.push('Alt');
			if (e.shiftKey) parts.push('Shift');
			if (e.metaKey) parts.push('Super');

			// Normalise key name
			let key = e.key;
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

		onSave(draft);
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
