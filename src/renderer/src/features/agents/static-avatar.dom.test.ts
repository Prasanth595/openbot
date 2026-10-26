import { AVATAR_SHAPES, encodeAvatarSeed, RESTING_EXPRESSIONS } from "@openbot/brand/agent-avatar";
import { createStaticAvatarSvg } from "@openbot/ui/agent-avatar";
import { describe, expect, it } from "vitest";

describe("createStaticAvatarSvg", () => {
  it("returns a self-contained SVG for every shape and expression", () => {
    for (const shape of AVATAR_SHAPES) {
      for (const expression of RESTING_EXPRESSIONS) {
        const svg = createStaticAvatarSvg(encodeAvatarSeed({ shape, expression }), 215);
        expect(svg).toBeInstanceOf(SVGSVGElement);
        expect(svg.getAttribute("aria-hidden")).toBe("true");
        const gradient = svg.querySelector("radialGradient");
        expect(gradient?.id).toBeTruthy();
        const paths = svg.querySelectorAll("path");
        // Body, shade and two eyes.
        expect(paths).toHaveLength(4);
        expect(paths[1]?.getAttribute("fill")).toBe(`url(#${gradient?.id})`);
        expect(svg.querySelectorAll("ellipse")).toHaveLength(expression === "shy" ? 2 : 0);
        expect(svg.querySelector("[class]")).toBeNull();
      }
    }
  });

  it("gives each image its own gradient id", () => {
    const first = createStaticAvatarSvg("agent", null).querySelector("radialGradient")?.id;
    const second = createStaticAvatarSvg("agent", null).querySelector("radialGradient")?.id;
    expect(first).not.toBe(second);
  });
});
