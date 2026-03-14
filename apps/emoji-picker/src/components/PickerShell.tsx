// Compact container that wraps the picker at target dimensions (~370x340px)
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { ReactNode } from 'react';

interface PickerShellProps {
	children: ReactNode;
}

export default function PickerShell({ children }: PickerShellProps) {
	return <div className="picker-shell">{children}</div>;
}
