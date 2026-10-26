import type { AvatarMood } from "@openbot/brand/agent-avatar-motion";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

function avatar(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".agent-avatar");
  if (!element) throw new Error("No avatar rendered.");
  return element;
}

describe("AgentAvatar", () => {
  it("draws a resting avatar as a still SVG that takes part in the shared beats", () => {
    const { container } = render(() => <AgentAvatar seed="face:v1:egg:shy" hue={215} />);
    const element = avatar(container);
    expect(element.dataset.avatar).toBe("generated");
    expect(element.dataset.life).toBe("rest");
    expect(element.dataset.blink).toBeUndefined();
    expect(element.querySelector("[data-motion]")).toBeNull();
    expect(element.querySelector("circle")).toBeNull();
    // Shy wears its blush: body, shade and two eyes, and two cheeks.
    expect(element.querySelectorAll("path")).toHaveLength(4);
    expect(element.querySelectorAll("ellipse")).toHaveLength(2);
  });

  it("gives each mood its face and motion, and keeps the shape", () => {
    const expected: Record<AvatarMood, { motion: string | null; ring: boolean }> = {
      idle: { motion: null, ring: false },
      working: { motion: "breathe", ring: true },
      waiting: { motion: "bob", ring: false },
      failed: { motion: "droop", ring: false },
      responded: { motion: "hop", ring: false },
      connecting: { motion: null, ring: true },
      asleep: { motion: "sleep", ring: false },
    };
    const bodies = new Set<string>();
    const moods: AvatarMood[] = ["idle", "working", "waiting", "failed", "responded", "connecting", "asleep"];
    for (const mood of moods) {
      const presentation = expected[mood];
      const { container, unmount } = render(() => <AgentAvatar seed="face:v1:cloud:happy" hue={null} mood={mood} />);
      const element = avatar(container);
      expect(element.dataset.mood).toBe(mood);
      expect(element.dataset.life).toBe(mood === "idle" ? "rest" : undefined);
      expect(element.querySelector("[data-motion]")?.getAttribute("data-motion") ?? null).toBe(presentation.motion);
      expect(element.querySelector("circle") !== null).toBe(presentation.ring);
      // The sleeping "z" is one more stroke after the body, the shade and the eyes.
      expect(element.querySelectorAll("path")).toHaveLength(mood === "asleep" ? 5 : 4);
      bodies.add(element.querySelector("path")?.getAttribute("d") ?? "");
      unmount();
    }
    expect(bodies.size).toBe(1);
  });

  it("blinks on its own loop only where it is featured", () => {
    const { container } = render(() => <AgentAvatar seed="agent" motion="always" />);
    const element = avatar(container);
    expect(element.dataset.blink).toBe("loop");
    expect(element.dataset.life).toBeUndefined();
  });
});
