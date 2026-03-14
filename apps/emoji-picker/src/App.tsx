// Root view that mounts the emoji picker inside the compact shell
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useState, useCallback } from "react";
import type { SkinTone } from "frimousse";
import PickerShell from "./components/PickerShell";
import EmojiPickerPanel from "./components/EmojiPickerPanel";
import type { EmojiSelection } from "./components/EmojiPickerPanel";
import "./App.css";

function App() {
  const [skinTone, setSkinTone] = useState<SkinTone>("none");
  const [lastSelected, setLastSelected] = useState<EmojiSelection | null>(null);

  const handleSelect = useCallback((selection: EmojiSelection) => {
    setLastSelected(selection);
  }, []);

  return (
    <main className="app-root">
      <PickerShell>
        <EmojiPickerPanel
          skinTone={skinTone}
          onSkinToneChange={setSkinTone}
          onEmojiSelect={handleSelect}
        />
      </PickerShell>

      {lastSelected && (
        <div className="selection-toast">
          Selected: {lastSelected.emoji} {lastSelected.label}
        </div>
      )}
    </main>
  );
}

export default App;
