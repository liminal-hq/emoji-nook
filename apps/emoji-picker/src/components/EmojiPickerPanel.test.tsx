// Tests the picker wrapper behaviour around search, preview, and selection
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import EmojiPickerPanel from "./EmojiPickerPanel";

vi.mock("./CategoryBar", () => ({
  default: function MockCategoryBar() {
    return <div data-testid="category-bar" />;
  },
}));

vi.mock("frimousse", async () => {
  const React = await import("react");

  type MockEmoji = {
    emoji: string;
    label: string;
    category: { label: string };
  };

  type PickerContextValue = {
    search: string;
    setSearch: (search: string) => void;
    skinTone: string;
    setSkinTone: (skinTone: string) => void;
    items: MockEmoji[];
    filteredItems: MockEmoji[];
    activeEmoji: MockEmoji | null;
    setActiveEmoji: (emoji: MockEmoji | null) => void;
    onEmojiSelect: (emoji: MockEmoji) => void;
  };

  const ITEMS: MockEmoji[] = [
    {
      emoji: "😀",
      label: "grinning face",
      category: { label: "Smileys & emotion" },
    },
    { emoji: "🍕", label: "pizza", category: { label: "Food & drink" } },
  ];

  const PickerContext = React.createContext<PickerContextValue | null>(null);

  function usePickerContext() {
    const value = React.useContext(PickerContext);
    if (!value) {
      throw new Error(
        "Mock EmojiPicker components must be rendered under Root",
      );
    }
    return value;
  }

  function Root({
    children,
    onEmojiSelect,
    skinTone,
  }: PropsWithChildren<{
    onEmojiSelect: (emoji: MockEmoji) => void;
    skinTone: string;
  }>) {
    const [search, setSearch] = React.useState("");
    const [activeEmoji, setActiveEmoji] = React.useState<MockEmoji | null>(
      null,
    );
    const [currentSkinTone, setSkinTone] = React.useState(skinTone);

    const filteredItems = ITEMS.filter((item) =>
      item.label.toLowerCase().includes(search.toLowerCase()),
    );

    return (
      <PickerContext.Provider
        value={{
          search,
          setSearch,
          skinTone: currentSkinTone,
          setSkinTone,
          items: ITEMS,
          filteredItems,
          activeEmoji,
          setActiveEmoji,
          onEmojiSelect,
        }}
      >
        <div data-testid="mock-picker-root">{children}</div>
      </PickerContext.Provider>
    );
  }

  const Search = React.forwardRef<
    HTMLInputElement,
    React.ComponentProps<"input">
  >(function Search(props, ref) {
    const { search, setSearch } = usePickerContext();
    return (
      <input
        {...props}
        ref={ref}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
    );
  });

  function SkinTone({
    children,
  }: {
    emoji: string;
    children: (props: {
      skinToneVariations: Array<{
        skinTone: string;
        emoji: string;
        onSelect: () => void;
      }>;
    }) => React.ReactNode;
  }) {
    const { setSkinTone } = usePickerContext();

    return children({
      skinToneVariations: [
        { skinTone: "none", emoji: "✋", onSelect: () => setSkinTone("none") },
        {
          skinTone: "light",
          emoji: "✋🏻",
          onSelect: () => setSkinTone("light"),
        },
      ],
    });
  }

  const Viewport = React.forwardRef<
    HTMLDivElement,
    React.ComponentProps<"div">
  >(function Viewport({ children, ...props }, ref) {
    return (
      <div {...props} ref={ref}>
        {children}
      </div>
    );
  });

  function Loading({ children }: PropsWithChildren) {
    return <>{children}</>;
  }

  function Empty({
    children,
  }: PropsWithChildren<{
    children: ({ search }: { search: string }) => React.ReactNode;
  }>) {
    const { search, filteredItems } = usePickerContext();
    if (!search || filteredItems.length > 0) return null;
    return <>{children({ search })}</>;
  }

  function List({
    components,
  }: {
    components: {
      CategoryHeader: (props: {
        category: { label: string };
      }) => React.ReactNode;
      Row: (props: { children: React.ReactNode }) => React.ReactNode;
      Emoji: (props: {
        emoji: MockEmoji;
        onClick?: () => void;
        onMouseEnter?: () => void;
      }) => React.ReactNode;
    };
  }) {
    const { filteredItems, setActiveEmoji, onEmojiSelect } = usePickerContext();

    const groups = filteredItems.reduce<Record<string, MockEmoji[]>>(
      (acc, item) => {
        const key = item.category.label;
        acc[key] ??= [];
        acc[key].push(item);
        return acc;
      },
      {},
    );

    return (
      <>
        {Object.entries(groups).map(([label, items]) => (
          <React.Fragment key={label}>
            {components.CategoryHeader({ category: { label } })}
            {components.Row({
              children: (
                <>
                  {items.map((item) => (
                    <React.Fragment key={item.label}>
                      {components.Emoji({
                        emoji: item,
                        onMouseEnter: () => setActiveEmoji(item),
                        onClick: () => onEmojiSelect(item),
                      })}
                    </React.Fragment>
                  ))}
                </>
              ),
            })}
          </React.Fragment>
        ))}
      </>
    );
  }

  function ActiveEmoji({
    children,
  }: PropsWithChildren<{
    children: ({ emoji }: { emoji: MockEmoji | null }) => React.ReactNode;
  }>) {
    const { activeEmoji } = usePickerContext();
    return <>{children({ emoji: activeEmoji })}</>;
  }

  return {
    EmojiPicker: {
      Root,
      Search,
      SkinTone,
      Viewport,
      Loading,
      Empty,
      List,
      ActiveEmoji,
    },
  };
});

describe("EmojiPickerPanel", () => {
  it("shows the search input and empty state for unmatched queries", () => {
    render(
      <EmojiPickerPanel
        skinTone="none"
        onSkinToneChange={vi.fn()}
        onEmojiSelect={vi.fn()}
      />,
    );

    const search = screen.getByPlaceholderText("Search emoji…");
    fireEvent.change(search, { target: { value: "zzz" } });

    expect(screen.getByText("No results for “zzz”")).toBeInTheDocument();
  });

  it("updates the preview on hover and emits selections", () => {
    const onEmojiSelect = vi.fn();

    render(
      <EmojiPickerPanel
        skinTone="none"
        onSkinToneChange={vi.fn()}
        onEmojiSelect={onEmojiSelect}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "grinning face" }));
    expect(screen.getByText("grinning face")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "pizza" }));
    expect(onEmojiSelect).toHaveBeenCalledWith({
      emoji: "🍕",
      label: "pizza",
      category: { label: "Food & drink" },
    });
  });
});
