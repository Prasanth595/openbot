import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { expect, it } from "vitest";
import type { ScreenCaptureRectangle, ScreenCaptureRequest } from "../backend/agent/screen-capture";
import { type CaptureDisplay, type CaptureImage, type CaptureSource, ScreenCapturer } from "./screen-capture";

// Failure modes: a capture without the macOS grant sends the wallpaper as the screen; the first
// refusal never raises the macOS prompt; a secondary display or a 2x display gives a region of the
// wrong display or the wrong pixels; an empty Windows image reaches the model as a capture.

/** An image that remembers what it is a cut of, so a test reads which pixels a capture took. */
function image(width: number, height: number, origin = "screen", cut?: ScreenCaptureRectangle): CaptureImage {
  return {
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    crop: (rectangle) => image(rectangle.width, rectangle.height, origin, rectangle),
    resize: (size) => image(size.width, size.height, origin, cut),
    toPNG: () =>
      new TextEncoder().encode(
        `${origin} ${cut ? `cut ${cut.x},${cut.y} ${cut.width}x${cut.height}` : "whole"} ${width}x${height}`,
      ),
  };
}

const PRIMARY: CaptureDisplay = {
  id: 1,
  label: "Built-in",
  bounds: { x: 0, y: 0, width: 1280, height: 800 },
  scaleFactor: 2,
};
// Left of the primary display and higher, as macOS lays out a monitor placed there.
const SECONDARY: CaptureDisplay = {
  id: 2,
  label: "Studio",
  bounds: { x: -1920, y: -200, width: 1920, height: 1080 },
  scaleFactor: 1,
};

function capturer(options: { platform?: NodeJS.Platform; access?: string; empty?: boolean } = {}) {
  const requests: Array<{ types: string[]; thumbnailSize: { width: number; height: number } }> = [];
  const host = new ScreenCapturer({
    platform: options.platform ?? "darwin",
    screenAccess: () => options.access ?? "granted",
    displays: () => [PRIMARY, SECONDARY],
    primaryDisplayId: () => PRIMARY.id,
    getSources: async (request) => {
      requests.push(request);
      const { width, height } = options.empty ? { width: 0, height: 0 } : request.thumbnailSize;
      const sources: CaptureSource[] = request.types.includes("screen")
        ? [PRIMARY, SECONDARY].map((display) => ({
            id: `screen:${display.id}:0`,
            name: `Screen ${display.id}`,
            display_id: String(display.id),
            thumbnail: image(width, height, `display ${display.id}`),
          }))
        : [{ id: "window:7:0", name: "Notes", display_id: "", thumbnail: image(width, height, "window 7") }];
      return sources;
    },
  });
  return { host, requests };
}

function decoded(png: Uint8Array): string {
  return new TextDecoder().decode(png);
}

const capture = (host: ScreenCapturer, request: ScreenCaptureRequest) => Effect.runPromise(host.capture(request));
const failure = (host: ScreenCapturer, request: ScreenCaptureRequest) =>
  Effect.runPromise(Effect.flip(host.capture(request)));

// Chromium reads a grant that was never asked for as "denied", the same as a grant the user refused.
it("refuses a capture on macOS without Screen Recording, and asks macOS only once", async () => {
  const { host, requests } = capturer({ access: "denied" });
  const permissionPrompt = { types: ["screen"], thumbnailSize: { width: 1, height: 1 } };
  expect((await failure(host, { target: "screen" })).reason).toBe(
    sourceText("error.agent.screenCapturePermissionMissing"),
  );
  expect(requests).toEqual([permissionPrompt]);
  expect((await failure(host, { target: "window", windowId: "window:7:0" })).reason).toBe(
    sourceText("error.agent.screenCapturePermissionMissing"),
  );
  expect(requests).toEqual([permissionPrompt]);
});

it("captures the primary display at its own pixels", async () => {
  const { host } = capturer();
  const result = await capture(host, { target: "screen" });
  expect(result).toMatchObject({ width: 2560, height: 1600, sourceName: "Built-in" });
  expect(decoded(result.png)).toBe("display 1 whole 2560x1600");
});

it("cuts a region from the secondary display that holds it, at that display's scale", async () => {
  const { host } = capturer();
  const region = { x: -1000, y: 0, width: 400, height: 300 };
  const result = await capture(host, { target: "region", region });
  expect(result).toMatchObject({ width: 400, height: 300, sourceName: "Studio" });
  expect(decoded(result.png)).toBe("display 2 cut 920,200 400x300 400x300");
});

it("doubles the pixels of a region on a 2x display", async () => {
  const { host } = capturer();
  const result = await capture(host, { target: "region", region: { x: 100, y: 50, width: 200, height: 100 } });
  expect(decoded(result.png)).toBe("display 1 cut 200,100 400x200 400x200");
});

it("refuses a region that crosses two displays", async () => {
  const { host } = capturer();
  const error = await failure(host, { target: "region", region: { x: -100, y: 0, width: 200, height: 100 } });
  expect(error.reason).toBe(sourceText("error.agent.screenCaptureRegionOutside"));
});

it("captures a named display and one window", async () => {
  const { host } = capturer();
  expect(decoded((await capture(host, { target: "screen", displayId: "2" })).png)).toBe("display 2 whole 1920x1080");
  const window = await capture(host, { target: "window", windowId: "window:7:0" });
  expect(window.sourceName).toBe("Notes");
  expect(decoded(window.png)).toBe("window 7 whole 1920x1920");
  const missing = await failure(host, { target: "window", windowId: "window:8:0" });
  expect(missing.reason).toBe(sourceText("error.agent.screenCaptureWindowMissing"));
});

it("reports an empty Windows image with guidance instead of sending it", async () => {
  const { host } = capturer({ platform: "win32", empty: true });
  const error = await failure(host, { target: "screen" });
  expect(error.reason).toBe(sourceText("error.agent.screenCaptureEmptyWindows"));
});
