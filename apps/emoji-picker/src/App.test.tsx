// Tests the root app wiring between picker selections and the Tauri command bridge
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("./hooks/useTheme", () => ({
  useTheme: vi.fn(),
}));

vi.mock("./components/EmojiPickerPanel", () => ({
  default: function MockEmojiPickerPanel({
    onEmojiSelect,
  }: {
    onEmojiSelect: (selection: { emoji: string; label: string }) => void;
  }) {
    return (
      <button
        type="button"
        onClick={() => onEmojiSelect({ emoji: "😀", label: "grinning face" })}
      >
        Select mock emoji
      </button>
    );
  },
}));

describe("App", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invokes the backend command and shows the selection toast", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Select mock emoji" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("insert_emoji", {
        emoji: "😀",
        label: "grinning face",
      }),
    );

    expect(screen.getByText("Selected: 😀 grinning face")).toBeInTheDocument();
  });
});
