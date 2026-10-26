import {
  AVATAR_BLUSH,
  AVATAR_EYE_STROKE,
  AVATAR_INK,
  AVATAR_SHADE_CENTER,
  AVATAR_SHADE_STOPS,
  AVATAR_VIEW_BOX,
  avatarDrawing,
  avatarProfile,
} from "@openbot/brand/agent-avatar";
import type { AvatarHue } from "@openbot/contracts/ipc";

/**
 * When a resting avatar may move, which is a performance decision and not a state one. `hover` and
 * `idle` stay still except for a rare shared blink (see `avatar-resting-life`); `always` blinks on
 * its own loop. What the avatar *expresses* is its `AvatarMood` - see `@openbot/brand/agent-avatar-motion`.
 */
export type AvatarMotion = "hover" | "always" | "idle";
export {
  AVATAR_HUE_CHOICES,
  AVATAR_SHAPES,
  avatarCandidateSeeds,
  avatarHeadColor,
  avatarHueSwatch,
  avatarProfile,
  RESTING_EXPRESSIONS,
  randomAvatarChoice,
  withAvatarChoice,
} from "@openbot/brand/agent-avatar";
export type { AvatarMood } from "@openbot/brand/agent-avatar-motion";

const SVG = "http://www.w3.org/2000/svg";
let staticAvatarCount = 0;

function svgElement(name: string, attributes: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/**
 * The avatar at rest as a self-contained SVG: no class, no stylesheet, no animation. It works in a
 * text editor token, a notification, or a canvas image.
 */
export function createStaticAvatarSvg(seed: string, hue: AvatarHue | null): SVGSVGElement {
  const profile = avatarProfile(seed, hue);
  const drawing = avatarDrawing(profile.shape, profile.expression);
  staticAvatarCount += 1;
  const shadeId = `agent-avatar-static-shade-${staticAvatarCount}`;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("xmlns", SVG);
  svg.setAttribute("viewBox", AVATAR_VIEW_BOX);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const defs = svgElement("defs", {});
  const gradient = svgElement("radialGradient", { id: shadeId, ...AVATAR_SHADE_CENTER });
  for (const stop of AVATAR_SHADE_STOPS) {
    gradient.appendChild(
      svgElement("stop", { offset: stop.offset, "stop-color": stop.color, "stop-opacity": stop.opacity }),
    );
  }
  defs.appendChild(gradient);
  svg.appendChild(defs);
  svg.appendChild(svgElement("path", { d: drawing.body, fill: profile.color }));
  svg.appendChild(svgElement("path", { d: drawing.body, fill: `url(#${shadeId})` }));
  if (drawing.blush) {
    for (const cx of [drawing.blush.left, drawing.blush.right]) {
      svg.appendChild(
        svgElement("ellipse", {
          cx,
          cy: drawing.blush.y,
          rx: AVATAR_BLUSH.rx,
          ry: AVATAR_BLUSH.ry,
          fill: AVATAR_INK.blush,
          opacity: AVATAR_BLUSH.opacity,
        }),
      );
    }
  }
  for (const eye of drawing.eyes) {
    const attributes: Record<string, string | number> =
      eye.paint === "fill"
        ? { d: eye.d, fill: AVATAR_INK.eye }
        : {
            d: eye.d,
            fill: "none",
            stroke: AVATAR_INK.eye,
            "stroke-width": AVATAR_EYE_STROKE,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
          };
    if (eye.transform) attributes.transform = eye.transform;
    svg.appendChild(svgElement("path", attributes));
  }
  return svg;
}
