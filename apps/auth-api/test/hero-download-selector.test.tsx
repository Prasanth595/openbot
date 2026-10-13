import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroDownloadSelector } from "../src/components/landing/HeroDownloadSelector";
import { DOWNLOAD_PLATFORMS } from "../src/lib/download-platforms";
import { OPENBOT_DOWNLOAD_LINKS } from "../src/lib/landing-links";
import { MOBILE_APP_ORDER, MOBILE_APPS } from "../src/lib/mobile-apps";

function setPlatform(platform: string, userAgent = ""): void {
  vi.stubGlobal("navigator", { platform, userAgent });
}

const AVAILABLE_PLATFORM_CASES: ReadonlyArray<
  readonly [source: string, platform: keyof typeof OPENBOT_DOWNLOAD_LINKS, label: string]
> = [
  ["MacIntel", "macos", "Download for macOS"],
  ["Win32", "windows", "Download for Windows"],
  ["Linux x86_64", "linux", "Download for Linux"],
];

describe("HeroDownloadSelector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(AVAILABLE_PLATFORM_CASES)(
    "detects %s and renders the available download",
    async (source, expected, label) => {
      setPlatform(source);
      const view = render(() => <HeroDownloadSelector />);

      const download = await view.findByRole("link", { name: label });
      expect(download).toHaveAttribute("href", OPENBOT_DOWNLOAD_LINKS[expected]);
      expect(download).not.toHaveAttribute("target");
      expect(download).not.toHaveAttribute("rel");
    },
  );

  it.each([
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "ios"],
    ["Linux armv8l", "Mozilla/5.0 (Linux; Android 15; Pixel 9)", "android"],
  ] as const)("offers the phone app on %s", async (source, userAgent, expected) => {
    setPlatform(source, userAgent);
    const view = render(() => <HeroDownloadSelector />);

    const app = await view.findByRole("link", { name: MOBILE_APPS[expected].action });
    expect(app).toHaveAttribute("href", MOBILE_APPS[expected].href);
    expect(app).toHaveAttribute("target", "_blank");
  });

  it("opens with arrow keys and closes on Escape or an outside click", async () => {
    setPlatform("Win32");
    const view = render(() => <HeroDownloadSelector />);
    const trigger = view.getByRole("button", { name: "Choose download platform" });

    await fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = await waitFor(() => view.getByRole("menu", { name: "Download platforms" }));
    await fireEvent.keyDown(menu, { key: "Escape" });
    expect(view.queryByRole("menu")).not.toBeInTheDocument();

    await fireEvent.click(trigger);
    await fireEvent.pointerDown(document.body);
    expect(view.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers every platform in the menu", async () => {
    setPlatform("MacIntel");
    const view = render(() => <HeroDownloadSelector />);
    const trigger = view.getByRole("button", { name: "Choose download platform" });

    await fireEvent.click(trigger);
    await waitFor(() => view.getByRole("menu", { name: "Download platforms" }));
    for (const [, platform] of AVAILABLE_PLATFORM_CASES) {
      const item = view.getByRole("menuitem", { name: `${DOWNLOAD_PLATFORMS[platform].label}Available` });
      expect(item).toHaveAttribute("href", OPENBOT_DOWNLOAD_LINKS[platform]);
    }
    for (const platform of MOBILE_APP_ORDER) {
      const app = MOBILE_APPS[platform];
      const item = view.getByRole("menuitem", { name: `${app.label}${app.status}` });
      expect(item).toHaveAttribute("href", app.href);
      expect(item).toHaveAttribute("target", "_blank");
    }
  });
});
