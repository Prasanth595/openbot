import { describe, expect, it } from "vitest";

import { showsTwoPane, sidebarWidth, TWO_PANE_MIN_WIDTH } from "./two-pane-layout";

describe("two-pane layout", () => {
  it("keeps the phone layout on a phone, whatever the window", () => {
    expect(showsTwoPane(402, false)).toBe(false);
    expect(showsTwoPane(932, false)).toBe(false);
  });

  it("keeps the phone layout in the narrow windows of Slide Over and Split View", () => {
    expect(showsTwoPane(320, true)).toBe(false);
    expect(showsTwoPane(TWO_PANE_MIN_WIDTH - 1, true)).toBe(false);
  });

  it("holds both panes in every full-screen iPad window, from the smallest portrait", () => {
    expect(showsTwoPane(TWO_PANE_MIN_WIDTH, true)).toBe(true);
    expect(showsTwoPane(834, true)).toBe(true);
    expect(showsTwoPane(1366, true)).toBe(true);
  });

  it("keeps the list between its two widths", () => {
    expect(sidebarWidth(TWO_PANE_MIN_WIDTH)).toBe(300);
    expect(sidebarWidth(1024)).toBe(328);
    expect(sidebarWidth(1366)).toBe(380);
  });
});
