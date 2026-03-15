// Persistent settings backed by tauri-plugin-store
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useState, useEffect, useCallback } from 'react';
import { load } from '@tauri-apps/plugin-store';
import type { SkinTone } from 'frimousse';

export interface Settings {
	shortcut: string;
	skinTone: SkinTone;
	closeOnSelect: boolean;
	autostart: boolean;
}

const DEFAULTS: Settings = {
	shortcut: 'Alt+Shift+E',
	skinTone: 'none',
	closeOnSelect: true,
	autostart: false,
};

const STORE_PATH = 'settings.json';

let storePromise: ReturnType<typeof load> | null = null;

function getStore() {
	if (!storePromise) {
		storePromise = load(STORE_PATH, {
			autoSave: true,
			defaults: DEFAULTS as unknown as Record<string, unknown>,
		});
	}
	return storePromise;
}

export async function loadSettings(): Promise<Settings> {
	const store = await getStore();
	const shortcut = ((await store.get('shortcut')) as string) ?? DEFAULTS.shortcut;
	const skinTone = ((await store.get('skinTone')) as SkinTone) ?? DEFAULTS.skinTone;
	const closeOnSelect = (await store.get('closeOnSelect')) ?? DEFAULTS.closeOnSelect;
	const autostart = (await store.get('autostart')) ?? DEFAULTS.autostart;
	return {
		shortcut,
		skinTone,
		closeOnSelect: closeOnSelect as boolean,
		autostart: autostart as boolean,
	};
}

export async function saveSettings(settings: Settings): Promise<void> {
	const store = await getStore();
	await store.set('shortcut', settings.shortcut);
	await store.set('skinTone', settings.skinTone);
	await store.set('closeOnSelect', settings.closeOnSelect);
	await store.set('autostart', settings.autostart);
	await store.save();
}

export function useSettings() {
	const [settings, setSettings] = useState<Settings>(DEFAULTS);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		loadSettings().then((s) => {
			setSettings(s);
			setLoaded(true);
		});
	}, []);

	const update = useCallback(async (next: Settings) => {
		setSettings(next);
		await saveSettings(next);
	}, []);

	return { settings, loaded, update };
}
