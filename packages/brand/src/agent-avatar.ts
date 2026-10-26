import type { AvatarHue } from "@openbot/contracts/ipc";

/**
 * The generated agent avatar: a soft body, two eyes, and nothing else.
 *
 * Everything here is plain data and path strings, so desktop, web and a static share card draw the
 * same avatar from one source. The body is a radial profile r(theta) built from a few harmonics,
 * sampled and closed with Catmull-Rom curves: every shape is smooth all round, with no corner.
 *
 * An agent stores only `avatarSeed` and `avatarHue`. A seed made by the picker names its shape and
 * expression (`face:v1:<shape>:<expression>[:<auto hue>]`); any other seed is hashed to a shape and
 * an expression, the same way the previous avatar library did, so an old agent keeps its look.
 */

export const AVATAR_SHAPES = ["circle", "pebble", "squircle", "capsule", "onigiri", "hex", "cloud", "egg"] as const;
export type AvatarShapeId = (typeof AVATAR_SHAPES)[number];

/**
 * The faces an agent can wear at rest. The faces that read as a mood - sad, sleepy, the working
 * look - are not here: an agent wears its resting face all the time, and a mood lends its face
 * only while it lasts (see `agent-avatar-motion`).
 */
export const RESTING_EXPRESSIONS = [
  "neutral",
  "attentive",
  "happy",
  "excited",
  "laugh",
  "curious",
  "proud",
  "shy",
] as const;
export type AvatarExpressionId = (typeof RESTING_EXPRESSIONS)[number];

/** Every face, the resting ones and the ones that only a mood shows. */
export type AvatarFaceId = AvatarExpressionId | "wink" | "sad" | "sleepy" | "focus";

/** The colour of each stored hue. Hue 100 (lime) stays valid for stored agents but is not offered. */
const HUE_COLORS: Readonly<Record<AvatarHue, string>> = {
  0: "#ee5d4f",
  30: "#f29340",
  55: "#efbf3a",
  100: "#9bc64a",
  150: "#4cc08a",
  185: "#35b5c2",
  215: "#4a8cf0",
  245: "#6c6bef",
  280: "#a066e6",
  320: "#ea6aa6",
};

/** Fixed inks of the drawing. They are part of the avatar, not of the app theme. */
export const AVATAR_INK = {
  eye: "#ffffff",
  blush: "#ff8aa0",
  shadeLight: "#ffffff",
  shadeDark: "#000000",
} as const;

/** The shade over the body: light at the upper left, dark at the lower right. Offset, colour, opacity. */
export const AVATAR_SHADE_STOPS: ReadonlyArray<{ offset: number; color: string; opacity: number }> = [
  { offset: 0, color: AVATAR_INK.shadeLight, opacity: 0.34 },
  { offset: 0.5, color: AVATAR_INK.shadeLight, opacity: 0 },
  { offset: 1, color: AVATAR_INK.shadeDark, opacity: 0.16 },
];
export const AVATAR_SHADE_CENTER = { cx: "34%", cy: "26%", r: "85%" } as const;

/**
 * The drawing space. The body is centred on (50, 52) with a radius near 37. The view box keeps the
 * body the same share of the image (about 0.63) that the previous avatar had, so every layout that
 * sizes or lifts `.agent-avatar > svg` stays correct.
 */
export const AVATAR_VIEW_BOX = "-8 -6 116 116";
export const AVATAR_RING = { cx: 50, cy: 52, r: 47 } as const;
export const AVATAR_EYE_STROKE = 5.2;
export const AVATAR_BLUSH = { rx: 6.5, ry: 3.6, opacity: 0.55 } as const;
/** The floating "z" of a sleeping agent, in drawing units. */
export const AVATAR_SNOOZE = { x: 79, y: 22, size: 15 } as const;

export const AVATAR_HUE_OPTIONS: ReadonlyArray<{
  hue: AvatarHue;
  label: string;
}> = [
  { hue: 0, label: "Red" },
  { hue: 30, label: "Orange" },
  { hue: 55, label: "Yellow" },
  { hue: 100, label: "Lime" },
  { hue: 150, label: "Green" },
  { hue: 185, label: "Cyan" },
  { hue: 215, label: "Blue" },
  { hue: 245, label: "Indigo" },
  { hue: 280, label: "Violet" },
  { hue: 320, label: "Magenta" },
];

/** The colours a picker offers. Hue 100 stays valid for stored agents, but is too close to green. */
export const AVATAR_HUE_CHOICES = AVATAR_HUE_OPTIONS.filter((option) => option.hue !== 100);

/**
 * The automatic colours, in the order the previous library hashed its eight automatic colours
 * (red, orange, amber, green, turquoise, blue, violet, rose), so an old agent keeps its colour family.
 */
const AUTOMATIC_HUES = [0, 30, 55, 150, 185, 215, 280, 320] as const satisfies readonly AvatarHue[];

/**
 * The shapes of the previous library, in its order, as the shape each one became. Its eighth shape,
 * the drop, was never shown: a seed that hashed to it took one of the first seven instead. Keeping
 * both rules keeps every old seed on the shape it had.
 */
const LEGACY_SHAPES = [
  "circle",
  "pebble",
  "squircle",
  "capsule",
  "onigiri",
  "hex",
  "cloud",
] as const satisfies readonly AvatarShapeId[];
const LEGACY_SHAPE_COUNT = LEGACY_SHAPES.length + 1;

const SEED_PREFIX = "face:v1:";

export interface AvatarProfile {
  shape: AvatarShapeId;
  expression: AvatarExpressionId;
  /** The hue drawn: the stored one, or the automatic one when none is stored. */
  hue: AvatarHue;
  /** The hue `null` draws for this seed. */
  automaticHue: AvatarHue;
  /** The body colour, as a hex string. */
  color: string;
}

export interface AvatarChoice {
  shape: AvatarShapeId;
  expression: AvatarExpressionId;
  /** The automatic colour the seed keeps, so a new shape does not change an automatic colour. */
  automaticHue?: AvatarHue | undefined;
}

function isAvatarShape(value: string): value is AvatarShapeId {
  return AVATAR_SHAPES.some((shape) => shape === value);
}

function isAvatarExpression(value: string): value is AvatarExpressionId {
  return RESTING_EXPRESSIONS.some((expression) => expression === value);
}

function isStoredHue(value: number): value is AvatarHue {
  return AVATAR_HUE_OPTIONS.some((option) => option.hue === value);
}

/** The seed that stores an explicit choice. It matches the contract's seed pattern. */
export function encodeAvatarSeed(choice: AvatarChoice): string {
  const base = `${SEED_PREFIX}${choice.shape}:${choice.expression}`;
  return choice.automaticHue === undefined ? base : `${base}:${choice.automaticHue}`;
}

/** The explicit choice a seed stores, or `null` for any other seed. */
export function decodeAvatarSeed(seed: string): AvatarChoice | null {
  if (!seed.startsWith(SEED_PREFIX)) return null;
  const [shape, expression, hue, ...rest] = seed.slice(SEED_PREFIX.length).split(":");
  if (rest.length > 0 || shape === undefined || expression === undefined) return null;
  if (!isAvatarShape(shape) || !isAvatarExpression(expression)) return null;
  if (hue === undefined) return { shape, expression };
  const value = /^\d{1,3}$/.test(hue) ? Number(hue) : Number.NaN;
  return isStoredHue(value) ? { shape, expression, automaticHue: value } : null;
}

export function avatarProfile(seed: string, hue: AvatarHue | null): AvatarProfile {
  const choice = decodeAvatarSeed(seed);
  const automaticHue = choice?.automaticHue ?? requiredItem(AUTOMATIC_HUES, stableIndex(`${seed}:color`, 8));
  const drawn = hue ?? automaticHue;
  return {
    shape: choice?.shape ?? legacyShape(seed),
    expression:
      choice?.expression ??
      requiredItem(RESTING_EXPRESSIONS, stableIndex(`${seed}:expression`, RESTING_EXPRESSIONS.length)),
    hue: drawn,
    automaticHue,
    color: HUE_COLORS[drawn],
  };
}

function legacyShape(seed: string): AvatarShapeId {
  const stored = LEGACY_SHAPES[stableIndex(`${seed}:shape`, LEGACY_SHAPE_COUNT)];
  return stored ?? requiredItem(LEGACY_SHAPES, stableIndex(`${seed}:shape:replacement`, LEGACY_SHAPES.length));
}

/** The seed for the same avatar with one part changed. The automatic colour stays with it. */
export function withAvatarChoice(seed: string, change: Partial<Pick<AvatarChoice, "shape" | "expression">>): string {
  const profile = avatarProfile(seed, null);
  return encodeAvatarSeed({
    shape: change.shape ?? profile.shape,
    expression: change.expression ?? profile.expression,
    automaticHue: profile.automaticHue,
  });
}

export function avatarHueSwatch(hue: AvatarHue): string {
  return HUE_COLORS[hue];
}

export function avatarHeadColor(seed: string, hue: AvatarHue | null): string {
  return avatarProfile(seed, hue).color;
}

/**
 * Twelve ready avatars for a picker that shows whole faces: the current one first, then every other
 * shape once, each with a different expression, then more pairs. The same agent and batch always
 * give the same list.
 */
export function avatarCandidateSeeds(agentId: string, currentSeed: string, batch: number): string[] {
  const current = avatarProfile(currentSeed, null);
  const candidates = [currentSeed];
  const seen = new Set([`${current.shape}:${current.expression}`]);
  const key = `${agentId}:avatar:${batch}`;
  const shapes = shuffled(AVATAR_SHAPES, `${key}:shape`);
  const expressions = shuffled(RESTING_EXPRESSIONS, `${key}:expression`).filter(
    (expression) => expression !== current.expression,
  );
  const order = [...shapes.filter((shape) => shape !== current.shape), ...shapes];
  let next = 0;
  for (let index = 0; candidates.length < 12 && index < order.length * expressions.length; index += 1) {
    const shape = requiredItem(order, index % order.length);
    for (let attempt = 0; attempt < expressions.length; attempt += 1) {
      const expression = requiredItem(expressions, next % expressions.length);
      next += 1;
      const pair = `${shape}:${expression}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      candidates.push(encodeAvatarSeed({ shape, expression, automaticHue: current.automaticHue }));
      break;
    }
  }
  return candidates;
}

/** A shape, expression and colour picked at random, as a seed and a hue. */
export function randomAvatarChoice(random: () => number = Math.random): { seed: string; hue: AvatarHue } {
  const shape = requiredItem(AVATAR_SHAPES, Math.floor(random() * AVATAR_SHAPES.length) % AVATAR_SHAPES.length);
  const expression = requiredItem(
    RESTING_EXPRESSIONS,
    Math.floor(random() * RESTING_EXPRESSIONS.length) % RESTING_EXPRESSIONS.length,
  );
  const hue = requiredItem(
    AVATAR_HUE_CHOICES,
    Math.floor(random() * AVATAR_HUE_CHOICES.length) % AVATAR_HUE_CHOICES.length,
  ).hue;
  return { seed: encodeAvatarSeed({ shape, expression, automaticHue: hue }), hue };
}

// Geometry ------------------------------------------------------------------------------------

interface ShapeSpec {
  radius: (theta: number) => number;
  scaleX?: number;
  scaleY?: number;
  /** How far the eyes sit below the middle, and how much closer together they are. */
  eyeDrop?: number;
  eyeSpread?: number;
}

function superellipse(theta: number, power: number, width: number, height: number): number {
  return (Math.abs(Math.cos(theta) / width) ** power + Math.abs(Math.sin(theta) / height) ** power) ** (-1 / power);
}

const SHAPE_SPECS: Readonly<Record<AvatarShapeId, ShapeSpec>> = {
  circle: { radius: () => 0.97 },
  pebble: { radius: (t) => 0.97 * (1 + 0.05 * Math.cos(2 * t) + 0.03 * Math.cos(3 * t + 0.6)) },
  squircle: { radius: (t) => 0.93 * superellipse(t, 3.1, 1, 1) },
  capsule: { radius: (t) => superellipse(t, 2.5, 1.12, 0.84) },
  onigiri: { radius: (t) => 0.95 * (1 + 0.11 * Math.cos(3 * (t + Math.PI / 2))), eyeDrop: 5, eyeSpread: -1 },
  hex: { radius: (t) => 0.97 * (1 + 0.04 * Math.cos(6 * t)) },
  cloud: { radius: (t) => 0.94 * (1 + 0.045 * Math.cos(7 * t + Math.PI / 2)) },
  egg: { radius: (t) => 0.93 * (1 + 0.08 * Math.sin(t)), scaleX: 0.9, scaleY: 1.05, eyeDrop: 3, eyeSpread: -1 },
};

const BODY_SAMPLES = 96;
const BODY_RADIUS = 37;
const BODY_CENTER = { x: 50, y: 52 } as const;

const bodyPaths = new Map<AvatarShapeId, string>();

function fixed(value: number): string {
  return value.toFixed(2);
}

/** The closed body outline of a shape: sampled radii joined by Catmull-Rom curves. */
export function avatarBodyPath(shape: AvatarShapeId): string {
  const cached = bodyPaths.get(shape);
  if (cached) return cached;
  const spec = SHAPE_SPECS[shape];
  const points: Array<readonly [number, number]> = [];
  for (let index = 0; index < BODY_SAMPLES; index += 1) {
    const theta = (index / BODY_SAMPLES) * Math.PI * 2;
    const radius = BODY_RADIUS * spec.radius(theta);
    points.push([
      BODY_CENTER.x + radius * Math.cos(theta) * (spec.scaleX ?? 1),
      BODY_CENTER.y + radius * Math.sin(theta) * (spec.scaleY ?? 1),
    ]);
  }
  const at = (index: number) => requiredItem(points, (index + BODY_SAMPLES) % BODY_SAMPLES);
  const [startX, startY] = at(0);
  let path = `M${fixed(startX)} ${fixed(startY)}`;
  for (let index = 0; index < BODY_SAMPLES; index += 1) {
    const [x0, y0] = at(index - 1);
    const [x1, y1] = at(index);
    const [x2, y2] = at(index + 1);
    const [x3, y3] = at(index + 2);
    path +=
      `C${fixed(x1 + (x2 - x0) / 6)} ${fixed(y1 + (y2 - y0) / 6)} ` +
      `${fixed(x2 - (x3 - x1) / 6)} ${fixed(y2 - (y3 - y1) / 6)} ${fixed(x2)} ${fixed(y2)}`;
  }
  const result = `${path}Z`;
  bodyPaths.set(shape, result);
  return result;
}

type EyeKind = "pill" | "arc" | "line" | "chevronLeft" | "chevronRight";

interface EyeSpec {
  kind: EyeKind;
  width: number;
  height: number;
  dx: number;
  dy: number;
  rotate: number;
}

interface FaceSpec {
  left: EyeSpec;
  right: EyeSpec;
  blush?: boolean;
}

function pill(width: number, height: number, extra: Partial<EyeSpec> = {}): EyeSpec {
  return { kind: "pill", width, height, dx: 0, dy: 0, rotate: 0, ...extra };
}

function stroke(kind: Exclude<EyeKind, "pill">, width: number, dy = 0): EyeSpec {
  return { kind, width, height: 0, dx: 0, dy, rotate: 0 };
}

/** Both eyes alike; `mirror` turns the right eye the other way. */
function both(eye: EyeSpec, mirror = false): Pick<FaceSpec, "left" | "right"> {
  return { left: eye, right: { ...eye, rotate: mirror ? -eye.rotate : eye.rotate } };
}

const FACE_SPECS: Readonly<Record<AvatarFaceId, FaceSpec>> = {
  neutral: both(pill(9, 17)),
  attentive: both(pill(9.5, 13, { dy: -1 })),
  happy: both(stroke("arc", 12, 1)),
  excited: both(pill(11, 20, { dy: -1 })),
  laugh: { left: stroke("chevronLeft", 9), right: stroke("chevronRight", 9) },
  curious: { left: pill(9, 18, { rotate: -7 }), right: pill(8.5, 12, { rotate: -7, dy: 1 }) },
  proud: both(pill(10, 8, { dy: 3, rotate: 9 }), true),
  shy: { ...both(pill(7.5, 12, { dx: -3, dy: 3 })), blush: true },
  wink: { left: pill(9, 17), right: stroke("arc", 11, 1) },
  sad: both(pill(8, 12, { dy: 3, rotate: 16 }), true),
  sleepy: both(stroke("line", 11, 3)),
  focus: both(pill(9, 13, { dx: 3, dy: -3 })),
};

export interface AvatarEyeDrawing {
  d: string;
  transform: string;
  /** A filled capsule, or a white stroke (arc, line, chevron). */
  paint: "fill" | "stroke";
}

export interface AvatarDrawing {
  body: string;
  eyes: readonly [AvatarEyeDrawing, AvatarEyeDrawing];
  /** Whether the eyes are open capsules, which can blink. */
  blinks: boolean;
  blush: { left: number; right: number; y: number } | null;
}

function eyeDrawing(spec: EyeSpec, centerX: number, centerY: number): AvatarEyeDrawing {
  const x = centerX + spec.dx;
  const y = centerY + spec.dy;
  const transform = spec.rotate === 0 ? "" : `rotate(${spec.rotate} ${fixed(x)} ${fixed(y)})`;
  if (spec.kind === "pill") {
    const { width, height } = spec;
    if (height >= width) {
      const r = width / 2;
      const top = y - height / 2 + r;
      const bottom = y + height / 2 - r;
      return {
        d:
          `M${fixed(x - r)} ${fixed(top)}A${r} ${r} 0 0 1 ${fixed(x + r)} ${fixed(top)}` +
          `L${fixed(x + r)} ${fixed(bottom)}A${r} ${r} 0 0 1 ${fixed(x - r)} ${fixed(bottom)}Z`,
        transform,
        paint: "fill",
      };
    }
    const r = height / 2;
    const left = x - width / 2 + r;
    const right = x + width / 2 - r;
    return {
      d:
        `M${fixed(left)} ${fixed(y + r)}A${r} ${r} 0 0 1 ${fixed(left)} ${fixed(y - r)}` +
        `L${fixed(right)} ${fixed(y - r)}A${r} ${r} 0 0 1 ${fixed(right)} ${fixed(y + r)}Z`,
      transform,
      paint: "fill",
    };
  }
  const half = spec.width / 2;
  const paths: Readonly<Record<Exclude<EyeKind, "pill">, string>> = {
    arc: `M${fixed(x - half)} ${fixed(y + 2.5)}Q${fixed(x)} ${fixed(y - half * 1.5)} ${fixed(x + half)} ${fixed(y + 2.5)}`,
    line: `M${fixed(x - half)} ${fixed(y)}Q${fixed(x)} ${fixed(y + 3)} ${fixed(x + half)} ${fixed(y)}`,
    chevronLeft: `M${fixed(x - 4)} ${fixed(y - 5.5)}L${fixed(x + 4)} ${fixed(y)}L${fixed(x - 4)} ${fixed(y + 5.5)}`,
    chevronRight: `M${fixed(x + 4)} ${fixed(y - 5.5)}L${fixed(x - 4)} ${fixed(y)}L${fixed(x + 4)} ${fixed(y + 5.5)}`,
  };
  return { d: paths[spec.kind], transform, paint: "stroke" };
}

const drawings = new Map<string, AvatarDrawing>();

/** The body and face of an avatar, in the drawing space of `AVATAR_VIEW_BOX`. */
export function avatarDrawing(shape: AvatarShapeId, face: AvatarFaceId): AvatarDrawing {
  const key = `${shape}:${face}`;
  const cached = drawings.get(key);
  if (cached) return cached;
  const spec = SHAPE_SPECS[shape];
  const faceSpec = FACE_SPECS[face];
  const eyeY = 50 + (spec.eyeDrop ?? 0);
  const spread = 11 + (spec.eyeSpread ?? 0);
  const drawing: AvatarDrawing = {
    body: avatarBodyPath(shape),
    eyes: [eyeDrawing(faceSpec.left, 50 - spread, eyeY), eyeDrawing(faceSpec.right, 50 + spread, eyeY)],
    blinks: faceSpec.left.kind === "pill" && faceSpec.right.kind === "pill",
    blush: faceSpec.blush ? { left: 50 - spread - 9, right: 50 + spread + 9, y: eyeY + 11 } : null,
  };
  drawings.set(key, drawing);
  return drawing;
}

// Hashing -------------------------------------------------------------------------------------

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stableIndex(value: string, length: number): number {
  return stableHash(value) % length;
}

function shuffled<T extends string>(items: readonly T[], key: string): T[] {
  return [...items].sort((a, b) => stableHash(`${key}:${a}`) - stableHash(`${key}:${b}`));
}

function requiredItem<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error("Avatar options are empty.");
  return item;
}
