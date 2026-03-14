// Row of category icon buttons that scroll the picker viewport to each section
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useCallback, useEffect, useRef, useState } from "react";

/** Emoji categories in emojibase order, with representative emoji icons. */
const CATEGORIES = [
  { id: "smileys-emotion", label: "Smileys & emotion", icon: "😀" },
  { id: "people-body", label: "People & body", icon: "👋" },
  { id: "animals-nature", label: "Animals & nature", icon: "🐱" },
  { id: "food-drink", label: "Food & drink", icon: "🍕" },
  { id: "travel-places", label: "Travel & places", icon: "✈️" },
  { id: "activities", label: "Activities", icon: "⚽" },
  { id: "objects", label: "Objects", icon: "💡" },
  { id: "symbols", label: "Symbols", icon: "💛" },
  { id: "flags", label: "Flags", icon: "🏁" },
] as const;

interface CategoryBarProps {
  /** Ref to the viewport element for observing scroll position. */
  viewportRef: React.RefObject<HTMLDivElement | null>;
}

export default function CategoryBar({ viewportRef }: CategoryBarProps) {
  const [activeId, setActiveId] = useState<string>(CATEGORIES[0].id);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Observe which category header is currently visible at the top of the viewport.
  // A MutationObserver watches for headers that Frimousse renders asynchronously
  // after its loading phase, so the IntersectionObserver stays in sync.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.categoryId;
            if (id) setActiveId(id);
          }
        }
      },
      {
        root: viewport,
        rootMargin: "0px 0px -85% 0px",
        threshold: 0,
      },
    );
    observerRef.current = io;

    const observed = new Set<Element>();

    function observeHeaders() {
      const headers = viewport!.querySelectorAll("[data-category-id]");
      headers.forEach((h) => {
        if (!observed.has(h)) {
          observed.add(h);
          io.observe(h);
        }
      });
    }

    observeHeaders();

    const mo = new MutationObserver(() => observeHeaders());
    mo.observe(viewport, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [viewportRef]);

  const scrollTo = useCallback(
    (categoryId: string) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const header = viewport.querySelector(
        `[data-category-id="${categoryId}"]`,
      ) as HTMLElement | null;
      if (!header) return;

      // Calculate target scroll position using bounding rects, which works
      // regardless of DOM nesting or virtualisation.
      const viewportRect = viewport.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const offset = headerRect.top - viewportRect.top + viewport.scrollTop;
      viewport.scrollTo({ top: offset, behavior: "smooth" });
    },
    [viewportRef],
  );

  return (
    <div className="category-bar" role="tablist" aria-label="Emoji categories">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          role="tab"
          aria-selected={activeId === cat.id}
          className={`category-tab${activeId === cat.id ? " active" : ""}`}
          title={cat.label}
          onClick={() => scrollTo(cat.id)}
        >
          {cat.icon}
        </button>
      ))}
    </div>
  );
}
