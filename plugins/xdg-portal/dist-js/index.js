// Provides JavaScript guest bindings for the XDG portal plugin
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { invoke } from '@tauri-apps/api/core';

const PREFIX = 'plugin:xdg-portal|';

function cmd(name, args) {
  return invoke(`${PREFIX}${name}`, args);
}

export const portal = {
  checkAvailability: () => cmd('check_availability'),
  getThemeInfo: () => cmd('get_theme_info'),
};
