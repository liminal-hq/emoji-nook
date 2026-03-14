// Tests category tab scrolling behaviour against the picker viewport
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { fireEvent, render, screen } from "@testing-library/react";
import CategoryBar from "./CategoryBar";

class MockIntersectionObserver {
  observe() {}
  disconnect() {}
}

describe("CategoryBar", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scrolls the viewport to the matching category header", () => {
    const viewport = document.createElement("div");
    const peopleHeader = document.createElement("div");

    viewport.scrollTop = 12;
    viewport.scrollTo = vi.fn();
    viewport.getBoundingClientRect = () =>
      ({
        top: 50,
      }) as DOMRect;

    peopleHeader.dataset.categoryId = "people-body";
    peopleHeader.getBoundingClientRect = () =>
      ({
        top: 180,
      }) as DOMRect;

    viewport.appendChild(peopleHeader);

    render(<CategoryBar viewportRef={{ current: viewport }} />);

    fireEvent.click(screen.getByTitle("People & body"));

    expect(viewport.scrollTo).toHaveBeenCalledWith({
      top: 142,
      behavior: "smooth",
    });
  });
});
