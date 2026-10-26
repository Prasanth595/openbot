import {
  AVATAR_HUE_CHOICES,
  AVATAR_SHAPES,
  avatarBodyPath,
  avatarCandidateSeeds,
  avatarDrawing,
  avatarHeadColor,
  avatarProfile,
  decodeAvatarSeed,
  encodeAvatarSeed,
  RESTING_EXPRESSIONS,
  randomAvatarChoice,
  withAvatarChoice,
} from "@openbot/brand/agent-avatar";
import { type AvatarMood, avatarMoodIsBusy, avatarMoodPresentation } from "@openbot/brand/agent-avatar-motion";
import { AVATAR_SEED_PATTERN } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";

const MOODS: readonly AvatarMood[] = ["idle", "working", "waiting", "failed", "responded", "connecting", "asleep"];
const FACES = [...RESTING_EXPRESSIONS, "wink", "sad", "sleepy", "focus"] as const;

function numbersIn(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe("avatar seeds", () => {
  it("round-trips every shape and expression, with and without an automatic hue", () => {
    for (const shape of AVATAR_SHAPES) {
      for (const expression of RESTING_EXPRESSIONS) {
        for (const automaticHue of [undefined, 0, 215, 320] as const) {
          const seed = encodeAvatarSeed({ shape, expression, automaticHue });
          expect(seed).toMatch(AVATAR_SEED_PATTERN);
          expect(decodeAvatarSeed(seed)).toEqual(
            automaticHue === undefined ? { shape, expression } : { shape, expression, automaticHue },
          );
          const profile = avatarProfile(seed, null);
          expect(profile.shape).toBe(shape);
          expect(profile.expression).toBe(expression);
          if (automaticHue !== undefined) expect(profile.hue).toBe(automaticHue);
        }
      }
    }
  });

  it("treats a malformed choice as an ordinary seed", () => {
    for (const seed of [
      "face:v1:star:happy",
      "face:v1:circle:angry",
      "face:v1:circle:happy:7",
      "face:v2:circle:happy",
    ]) {
      expect(decodeAvatarSeed(seed)).toBeNull();
      expect(AVATAR_SHAPES).toContain(avatarProfile(seed, null).shape);
    }
  });

  it("keeps the shape, face and colour family that old seeds had", () => {
    // Values of the previous avatar library for these seeds, mapped to the new names.
    expect(avatarProfile("agent", null)).toMatchObject({ shape: "pebble", expression: "proud", hue: 150 });
    expect(avatarProfile("first-bot", null)).toMatchObject({ shape: "squircle", expression: "shy", hue: 185 });
    expect(avatarProfile("crew-sleeper", null)).toMatchObject({ shape: "cloud", expression: "excited", hue: 0 });
    expect(avatarProfile("8f14e45f-ceea-467a-9575-b0b8f37a1f6a", null)).toMatchObject({
      shape: "onigiri",
      expression: "curious",
      hue: 55,
    });
  });

  it("never gives an old seed the egg, which the old library did not show", () => {
    for (let index = 0; index < 2000; index += 1) {
      expect(avatarProfile(`agent-${index}`, null).shape).not.toBe("egg");
    }
  });

  it("draws a stored hue over the automatic one", () => {
    expect(avatarHeadColor("agent", 215)).toBe(avatarProfile("face:v1:egg:shy", 215).color);
    expect(avatarProfile("agent", 215).automaticHue).toBe(150);
  });

  it("keeps the automatic colour when one part changes", () => {
    const changed = withAvatarChoice("agent", { shape: "egg" });
    expect(avatarProfile(changed, null)).toMatchObject({ shape: "egg", expression: "proud", hue: 150 });
    expect(avatarProfile(withAvatarChoice(changed, { expression: "shy" }), null)).toMatchObject({
      shape: "egg",
      expression: "shy",
      hue: 150,
    });
  });

  it("gives twelve different candidates, the current one first, the same each time", () => {
    const seeds = avatarCandidateSeeds("agent-1", "agent-1", 0);
    expect(seeds).toHaveLength(12);
    expect(seeds[0]).toBe("agent-1");
    const pairs = seeds.map((seed) => {
      const profile = avatarProfile(seed, null);
      return `${profile.shape}:${profile.expression}`;
    });
    expect(new Set(pairs).size).toBe(12);
    expect(new Set(pairs.map((pair) => pair.split(":")[0])).size).toBe(AVATAR_SHAPES.length);
    expect(avatarCandidateSeeds("agent-1", "agent-1", 0)).toEqual(seeds);
    expect(avatarCandidateSeeds("agent-1", "agent-1", 1)).not.toEqual(seeds);
  });

  it("picks a valid random choice", () => {
    const choice = randomAvatarChoice(() => 0.999);
    expect(choice.seed).toMatch(AVATAR_SEED_PATTERN);
    expect(AVATAR_HUE_CHOICES.map((option) => option.hue)).toContain(choice.hue);
  });
});

describe("avatar drawing", () => {
  it("closes every body without a corner or a bad number", () => {
    for (const shape of AVATAR_SHAPES) {
      const path = avatarBodyPath(shape);
      expect(path.startsWith("M")).toBe(true);
      expect(path.endsWith("Z")).toBe(true);
      expect(path).not.toMatch(/NaN|Infinity|L/);
      expect(path.match(/C/g)).toHaveLength(96);
      const numbers = numbersIn(path);
      expect(numbers.every(Number.isFinite)).toBe(true);
      // The body stays inside the view box with room for the ring.
      expect(Math.min(...numbers)).toBeGreaterThan(5);
      expect(Math.max(...numbers)).toBeLessThan(95);
      // The last point of the last curve is the start point.
      expect(numbers.slice(-2)).toEqual(numbers.slice(0, 2));
    }
  });

  it("draws every shape with every face", () => {
    for (const shape of AVATAR_SHAPES) {
      for (const face of FACES) {
        const drawing = avatarDrawing(shape, face);
        expect(drawing.eyes).toHaveLength(2);
        for (const eye of drawing.eyes) {
          expect(eye.d.length).toBeGreaterThan(0);
          expect(numbersIn(`${eye.d} ${eye.transform}`).every(Number.isFinite)).toBe(true);
        }
        expect(drawing.blush !== null).toBe(face === "shy");
      }
    }
    expect(avatarDrawing("circle", "neutral").blinks).toBe(true);
    expect(avatarDrawing("circle", "happy").blinks).toBe(false);
  });
});

describe("avatar moods", () => {
  it("keeps the busy moods to work and connecting", () => {
    expect(MOODS.filter(avatarMoodIsBusy)).toEqual(["working", "connecting"]);
  });

  it("lends a face to every mood but idle", () => {
    for (const mood of MOODS) {
      expect(avatarMoodPresentation(mood).face === null).toBe(mood === "idle");
    }
    expect(avatarMoodPresentation("asleep")).toMatchObject({ face: "sleepy", snooze: true });
    expect(avatarMoodPresentation("failed")).toMatchObject({ face: "sad", motion: "droop" });
  });
});
