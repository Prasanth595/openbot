import { cx, prefersReducedMotion } from "@openbot/ui/utils";
import { onSettled } from "solid-js";

const VERTEX = `#version 300 es
in vec2 aCorner;
void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

// All lengths in the shader are CSS pixels, with y down. uUnit scales the designed sizes to the window.
const FRAGMENT = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec3 uView;      // canvas width and height in device pixels, device pixels per CSS pixel
uniform float uClock;
uniform float uUnit;
uniform vec4 uBeam;      // x, falling head y, glow after the hit (0 to 1), flash
uniform vec4 uPanel;     // left, top, right, bottom of the surface
uniform float uRound;
uniform float uRun;      // how far the light has run along the top edge from the beam
uniform vec4 uDrip;      // depth of the light down the left and right sides, and its strength there
uniform vec4 uButton;    // left, top, right, bottom of the source element
uniform vec3 uButtonRing; // corner radius, how far the light has run around it, 1 when present
uniform vec3 uPointer;   // x, y, strength
uniform vec4 uLook;      // brightness, core width, glow width, reach along the edge
uniform vec4 uGrain;     // haze, motes, ripple, haze ramp
uniform vec2 uSeed;
uniform vec3 uPalette[6]; // hot, main, warm, cool, deep, mist

float sqr(float x) {
  return x * x;
}

// The PCG hash (Jarzynski and Olano, 2020). Integer maths gives the same value on every GPU.
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float cellRandom(vec2 cell) {
  uvec2 q = uvec2(ivec2(cell) + 65536);
  return float(pcg(q.x + pcg(q.y))) / 4294967295.0;
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = p - cell;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = cellRandom(cell);
  float b = cellRandom(cell + vec2(1.0, 0.0));
  float c = cellRandom(cell + vec2(0.0, 1.0));
  float d = cellRandom(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Signed distance from p to the edge of a rounded rectangle: negative inside.
float boxDistance(vec2 p, vec4 box, float radius) {
  vec2 middle = 0.5 * (box.xy + box.zw);
  vec2 inner = 0.5 * (box.zw - box.xy) - radius;
  vec2 d = abs(p - middle) - inner;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y) / uView.z;
  float panelD = boxDistance(p, uPanel, uRound);
  // The surface covers its own area, so nothing is drawn there. The surface is most of the hero.
  if (panelD < -1.0) {
    fragColor = vec4(0.0);
    return;
  }
  float k = uUnit;
  float dx = p.x - uBeam.x;
  float ax = abs(dx);
  // The light spreads further toward the middle of the surface than away from it.
  float awayX = ax * (1.0 + 0.8 * step(0.0, dx * (uBeam.x - 0.5 * (uPanel.x + uPanel.z))));
  float top = uPanel.y;
  float above = top - p.y;
  float glow = uBeam.z;
  float edgeOut = max(panelD, 0.0);
  vec3 side = mix(uPalette[3], uPalette[2], smoothstep(-40.0 * k, 40.0 * k, dx));
  vec3 col = vec3(0.0);

  // The beam: a white-hot core in a bright glow, in a wider and softer light. Ripples run down it.
  float coreW = uLook.y * k;
  float glowW = uLook.z * k;
  float lit = smoothstep(uBeam.y + 2.0, uBeam.y - 60.0 * k, p.y);
  float belowTop = exp(-sqr(max(-above, 0.0) / (36.0 * k)));
  float ripple = 1.0 + 0.22 * uGrain.z * sin(p.y * 0.035 / k - uClock * 5.0);
  float core = sqr(coreW) / (dx * dx + sqr(coreW));
  float inner = exp(-sqr(dx / glowW));
  float wide = glowW / (ax + glowW) * exp(-ax / (260.0 * k));
  col += (uPalette[0] * 9.0 * core + mix(uPalette[0], uPalette[1], 0.55) * 1.4 * inner + mix(uPalette[1], side, 0.4) * 1.3 * wide) * lit * belowTop * ripple;
  // Near the surface the white of the beam opens out, as light that hits a wall spreads on it.
  float flareAbove = max(above, 0.0);
  float flareW = 6.0 * k + 0.5 * max(220.0 * k - flareAbove, 0.0);
  col += mix(uPalette[0], uPalette[1], 0.2) * 7.0 * exp(-sqr(awayX / flareW)) * smoothstep(240.0 * k, 0.0, flareAbove) * belowTop * glow;

  // The head of the falling beam.
  float falling = 1.0 - glow;
  col += mix(uPalette[0], uPalette[1], 0.3) * 6.0 * exp(-length(vec2(dx * 1.6, p.y - uBeam.y)) / (9.0 * k)) * falling;

  // The source element: the light runs around its edge, and the beam leaves it from the bottom.
  if (uButtonRing.z > 0.5) {
    float buttonD = boxDistance(p, uButton, uButtonRing.x);
    float ringOut = max(buttonD, 0.0);
    float ringMask = 1.0 - smoothstep(uButtonRing.y - 18.0 * k, uButtonRing.y, ax);
    float nearBeam = 0.35 + 0.65 * exp(-ax / (32.0 * k));
    float rim = 2.6 / (1.0 + sqr(ringOut / 0.9)) + 0.5 * exp(-ringOut / (9.0 * k));
    col += mix(side, uPalette[0], 0.45) * rim * ringMask * nearBeam * smoothstep(-0.5, 0.5, buttonD);
    float exit = exp(-length(vec2(dx * 0.5, max(p.y - uButton.w, 0.0))) / (7.0 * k));
    col += mix(uPalette[0], uPalette[1], 0.3) * 5.0 * exit * smoothstep(uButton.w - 2.0, uButton.w + 4.0, p.y) * lit;
  }

  // The hit: a flash, then the light runs out along the top edge and lights the air above it.
  if (glow > 0.001) {
    float reach = uLook.w * 100.0 * k;
    float run = uRun;
    float reached = 1.0 - smoothstep(run - 30.0 * k, run, ax);
    float overTop = exp(-sqr(max(p.y - top - uRound, 0.0) / (14.0 * k)));
    float along = exp(-ax / reach);
    float line = 2.4 / (1.0 + sqr(edgeOut / 1.1)) + 0.7 * exp(-edgeOut / (12.0 * k));
    vec3 edgeK = mix(mix(uPalette[0], uPalette[1], smoothstep(0.0, 70.0 * k, ax)), side, smoothstep(50.0 * k, 3.0 * reach, ax));
    col += edgeK * line * along * reached * overTop * glow * 5.0;
    // A fan of light over the edge, tall and white near the beam, that thins out to the sides.
    float fanH = 30.0 * k + 0.1 * ax;
    float fan = exp(-max(above, 0.0) / fanH) * exp(-awayX / (1.3 * reach)) * step(0.0, above + uRound);
    vec3 fanK = mix(mix(uPalette[0], uPalette[1], smoothstep(0.0, 160.0 * k, ax)), side, 0.5 * smoothstep(100.0 * k, 2.0 * reach, ax));
    col += fanK * 5.0 * fan * reached * glow * smoothstep(-0.5, 0.5, panelD);
    // The glow of the beam opens out into a cone as it nears the surface.
    float coneW = glowW + 0.45 * max(260.0 * k - above, 0.0);
    float cone = exp(-ax / coneW) * smoothstep(300.0 * k, 0.0, above) * step(0.0, above + uRound);
    col += mix(uPalette[1], side, 0.5) * 1.2 * cone * glow;
    // A wide pool of light where the beam lands, with a white spot at its middle.
    float pool = exp(-sqr(awayX / (230.0 * k)) - max(above, 0.0) / (110.0 * k)) * step(0.0, above + uRound);
    float spot = exp(-length(vec2(dx, above * 2.2)) / (38.0 * k)) * step(0.0, above + uRound);
    // Along the edge, near the beam, the light burns out to white.
    float spill = exp(-awayX / (150.0 * k) - max(above, 0.0) / (26.0 * k)) * reached * step(0.0, above + uRound);
    col += (mix(uPalette[1], side, 0.3) * 2.0 * pool + uPalette[0] * 2.6 * spot + uPalette[0] * 5.0 * spill) * glow;
    float flash = uBeam.w;
    col += uPalette[0] * 4.0 * flash * exp(-length(vec2(dx, above * 1.8)) / (60.0 * k));

    // The light drips down the side that is nearer to the beam, and changes colour on the way.
    float leftHalf = step(p.x, 0.5 * (uPanel.x + uPanel.z));
    float dripFront = mix(uDrip.y, uDrip.x, leftHalf);
    float dripPower = mix(uDrip.w, uDrip.z, leftHalf);
    if (dripPower > 0.001) {
      float depth = max(p.y - top - uRound * 0.6, 0.0);
      float dripLen = 230.0 * k;
      float drawn = 1.0 - smoothstep(dripFront - 50.0 * k, dripFront, depth);
      float fade = exp(-depth / dripLen);
      float dripLine = 3.6 / (1.0 + sqr(edgeOut / 1.2)) + 1.1 * exp(-edgeOut / (16.0 * k));
      float shimmer = 0.75 + 0.5 * valueNoise(vec2(edgeOut / (6.0 * k), (depth - uClock * 60.0) / (22.0 * k)));
      vec3 dripK = mix(mix(uPalette[0], side, smoothstep(0.0, 40.0 * k, depth)), uPalette[4], smoothstep(0.0, dripLen * 1.5, depth));
      col += dripK * dripLine * drawn * fade * shimmer * dripPower * step(top + uRound * 0.3, p.y) * glow;
    }
  }

  // A violet fog of soft vertical strands around the beam. It is wider and thicker near the surface,
  // and outside the surface it hangs down past the top edge. The noise is stretched along y, so
  // each cell becomes a thin strand of light.
  float haze = uGrain.x * uGrain.w;
  float fogW = 70.0 * k + 0.3 * max(420.0 * k - max(above, 0.0), 0.0);
  float fogY = (0.5 + 0.5 * exp(-max(above, 0.0) / (300.0 * k))) * exp(-max(-above, 0.0) / (240.0 * k));
  float fogZone = exp(-awayX / fogW) * fogY * lit;
  if (haze * fogZone > 0.004) {
    float drift = uClock * 0.22;
    float thin = valueNoise(vec2(dx / (3.5 * k) + uSeed.x, p.y / (300.0 * k) - drift));
    float broad = valueNoise(vec2(dx / (13.0 * k) + uSeed.y, p.y / (150.0 * k) - drift * 1.7));
    float strand = smoothstep(0.2, 0.9, 0.3 * thin + 0.7 * broad);
    vec3 fogK = mix(uPalette[1], side, 0.2);
    col += fogK * fogZone * haze * (0.75 + 0.45 * strand) * (0.65 + 1.15 * glow);
  }

  // Motes that rise through the beam and twinkle.
  float motes = uGrain.y;
  if (motes > 0.01 && ax < 70.0 * k) {
    vec2 size = vec2(13.0, 21.0) * k;
    vec2 m = vec2(dx, p.y + uClock * 34.0) / size;
    vec2 cell = floor(m);
    float pick = cellRandom(cell + 7.0);
    vec2 spot = vec2(cellRandom(cell + 31.0), cellRandom(cell + 59.0));
    float dist = length((m - cell - spot) * size);
    float twinkle = 0.5 + 0.5 * sin(uClock * 4.3 + pick * 61.0);
    col += uPalette[0] * step(0.74, pick) * twinkle * exp(-dist * dist) * exp(-ax / (24.0 * k)) * lit * motes * 1.8;
  }

  // The pointer brings out the light that is near it.
  vec2 toPointer = p - uPointer.xy;
  float pointerLight = exp(-dot(toPointer, toPointer) / sqr(120.0 * k)) * uPointer.z;
  col *= (1.0 + 0.7 * pointerLight) * uLook.x;
  col *= smoothstep(-1.0, 0.5, panelD);

  // This curve reaches white, so the hot parts of the light burn out to pure white.
  vec3 shown = 1.0 - exp(-col);
  fragColor = vec4(shown, max(shown.r, max(shown.g, shown.b)));
}`;

type Rgb = readonly [number, number, number];

const BASE_SATURATION = 0.78;
// The hero is wide and tall. This ceiling keeps the frame time down on large retina screens; the
// light is soft, so it shows no loss.
const MAX_RENDER_DIM = 1600;
const MAX_DPR = 1.5;
/** The window size, in CSS pixels, that the sizes in the shader are designed for. */
const DESIGN_WIDTH = 1440;
const DESIGN_HEIGHT = 900;
/** The gap, in CSS pixels, between the beam and the text it must not cross. */
const BEAM_CLEARANCE = 56;
/** The time, in seconds, that the beam takes to fall onto the surface. It falls faster as it goes. */
const DROP_TIME = 0.75;
/** The longest time, in milliseconds, that the beam waits for `start` on screen before it falls in. */
const MAX_HOLD_MS = 2500;
/** The light runs along the top edge at this speed, in CSS pixels a second, and slows over `RUN_SLOW` seconds. */
const RUN_SPEED = 1500;
const RUN_SLOW = 0.55;
/** The light falls down the sides slower than it runs along the top, so it drips rather than drops. */
const DRIP_SPEED = 260;
const DRIP_ACCEL = 380;
/** How fast, in CSS pixels a second, the light runs around the source element after the beam reaches it. */
const RING_SPEED = 420;
/** After this time, in seconds, the beam has settled, and only the light in it still moves. */
const SETTLE_TIME = 7;
/**
 * A median frame time above this, in milliseconds, makes the canvas smaller. It is more than 33 ms, because
 * a power saving mode or a 30 Hz display limits a fast GPU to 30 frames a second.
 */
const SLOW_FRAME_MS = 40;
/** The number of frames in each median. One long task in the page does not move the median. */
const FRAME_SAMPLES = 20;
/** The smallest canvas, as a share of the full canvas. The light is soft, so it still looks the same. */
const MIN_QUALITY = 0.35;

interface BeamSettings {
  brightness: number;
  /** The width of the hot core, in CSS pixels at the design size. */
  core: number;
  /** The width of the glow around the core, in CSS pixels at the design size. */
  glow: number;
  /** How far the light reaches along the top edge of the surface, in hundreds of CSS pixels. */
  reach: number;
  /** How bright the light that drips down the near side is. */
  drip: number;
  haze: number;
  motes: number;
  ripple: number;
  speed: number;
  seed: number;
  /** A six-digit hex colour that replaces the `color` prop. */
  color?: string;
}

const SETTINGS: BeamSettings = {
  brightness: 1,
  core: 3,
  glow: 22,
  reach: 3,
  drip: 1,
  haze: 0.7,
  motes: 1,
  ripple: 1,
  speed: 1,
  seed: 3,
};

/** Tested looks. The random look on each visit starts from a mix of these and the default. */
const VERSIONS: Readonly<Record<string, BeamSettings>> = {
  // A wider, calmer glow with few motes.
  soft: {
    ...SETTINGS,
    brightness: 0.85,
    core: 2.4,
    glow: 20,
    reach: 2.8,
    drip: 0.8,
    haze: 1,
    motes: 0.5,
    ripple: 0.5,
    speed: 0.75,
  },
  // A thin, bright, bluer beam with little haze.
  laser: {
    ...SETTINGS,
    brightness: 1.15,
    core: 1,
    glow: 7,
    reach: 1.8,
    drip: 1.2,
    haze: 0.35,
    motes: 0.8,
    ripple: 1.4,
    speed: 1.3,
    color: "#6f8cff",
  },
  // A pinker beam in thick haze with many motes.
  haze: {
    ...SETTINGS,
    brightness: 1,
    core: 1.8,
    glow: 15,
    reach: 2.4,
    drip: 1,
    haze: 1.3,
    motes: 1.6,
    ripple: 0.9,
    speed: 1,
    seed: 16,
    color: "#d46cf5",
  },
};

/** A small seeded random number generator (mulberry32), so `?beam=<number>` shows the same look again. */
function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Tunable = Exclude<keyof BeamSettings, "seed" | "color">;

/**
 * The limits of each value in a random look. They are wider than the tested looks, so the looks
 * vary more, but each limit still gives a beam that reads well over the headline.
 */
const RANDOM_LIMITS: Readonly<Record<Tunable, readonly [number, number]>> = {
  brightness: [0.75, 1.3],
  core: [0.8, 3],
  glow: [5, 26],
  reach: [1.4, 3.4],
  drip: [0.6, 1.4],
  haze: [0.2, 1.5],
  motes: [0.3, 2],
  ripple: [0.3, 1.8],
  speed: [0.7, 1.5],
};

interface Look {
  settings: BeamSettings;
  color: Rgb;
  /** Multiplies the hue shifts of the palette. More than 1 puts more colours in one beam. */
  hueSpread: number;
}

/**
 * Mixes the tested looks with random weights, then moves each value up or down by as much as
 * 1.7 times, within `RANDOM_LIMITS`. The cube of each weight makes one look lead most mixes; an
 * even mix of all looks is always near the average, and all visits then look the same. The colour
 * can be any hue.
 */
function randomLook(seed: number): Look {
  const random = seededRandom(seed);
  const looks = [SETTINGS, ...Object.values(VERSIONS)];
  const weights = looks.map((_, index) => (-Math.log(1 - random())) ** 3 * (index === 0 ? 1.5 : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const wild = (key: Tunable) => {
    const mixed = looks.reduce((sum, look, index) => sum + (look[key] * (weights[index] ?? 0)) / total, 0);
    const [min, max] = RANDOM_LIMITS[key];
    return clamp(mixed * 1.7 ** (random() * 2 - 1), min, max);
  };
  return {
    settings: {
      brightness: wild("brightness"),
      core: wild("core"),
      glow: wild("glow"),
      reach: wild("reach"),
      drip: wild("drip"),
      haze: wild("haze"),
      motes: wild("motes"),
      ripple: wild("ripple"),
      speed: wild("speed"),
      // The noise seed only moves the haze, so any value is a good one.
      seed: random() * 20,
    },
    color: fromHsv(random() * 360, BASE_SATURATION * (0.85 + random() * 0.4), 1),
    hueSpread: 1 + random() * 2.5,
  };
}

/**
 * Each visit gets a new random look. `?beam=<name>` in the page address shows one tested look,
 * and `?beam=<number>` shows the random look with that seed again.
 */
function selectedLook(baseColor: string): Look & { seed: string } {
  const name = new URLSearchParams(window.location.search).get("beam") ?? "";
  const named = name === "default" ? SETTINGS : Object.hasOwn(VERSIONS, name) ? VERSIONS[name] : undefined;
  if (named) {
    return { settings: named, color: hexToRgb(named.color ?? baseColor), hueSpread: 1, seed: name };
  }
  const seed = /^\d+$/.test(name) ? Number(name) : Math.floor(Math.random() * 1_000_000);
  return { ...randomLook(seed), seed: String(seed) };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The hue shift in degrees, the saturation scale and the value of each palette entry, in the
 * order of `uPalette`: hot, main, warm, cool, deep, mist.
 */
const PALETTE: readonly (readonly [number, number, number])[] = [
  [0, 0.16, 1],
  [0, 1, 1],
  [34, 0.9, 1],
  [-46, 0.85, 1],
  [14, 1.2, 0.72],
  [-12, 0.65, 0.7],
];

function toHsv([r, g, b]: Rgb): [number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  return [(hue * 60 + 360) % 360, max > 0 ? delta / max : 0];
}

function fromHsv(hue: number, saturation: number, value: number): Rgb {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = saturation * value;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = value - c;
  const [r, g, b] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

function buildPalette(rgb: Rgb, hueSpread: number): Float32Array {
  const [hue, saturation] = toHsv(rgb);
  const data = new Float32Array(PALETTE.length * 3);
  PALETTE.forEach(([shift, scale, value], index) => {
    data.set(fromHsv(hue + shift * hueSpread, clamp(saturation * scale, 0, 1), value), index * 3);
  });
  return data;
}

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function buildProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

function uniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram) {
  const at = (name: string) => gl.getUniformLocation(program, name);
  return {
    uView: at("uView"),
    uClock: at("uClock"),
    uUnit: at("uUnit"),
    uBeam: at("uBeam"),
    uPanel: at("uPanel"),
    uRound: at("uRound"),
    uRun: at("uRun"),
    uDrip: at("uDrip"),
    uButton: at("uButton"),
    uButtonRing: at("uButtonRing"),
    uPointer: at("uPointer"),
    uLook: at("uLook"),
    uGrain: at("uGrain"),
    uSeed: at("uSeed"),
    uPalette: at("uPalette"),
  };
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
}

interface Surface extends Box {
  real: boolean;
}

/** The time, in seconds after the hit, at which light that runs at `RUN_SPEED` and slows down reaches `distance`. */
function runArrival(distance: number): number {
  const limit = RUN_SPEED * RUN_SLOW;
  return distance / (RUN_SPEED - Math.min(distance, limit * 0.98) / RUN_SLOW);
}

export interface LandingBeamProps {
  /** The element the beam lands on. The light runs along its top edge and drips down its nearer side. */
  surface: () => HTMLElement | undefined;
  /** The beam's horizontal position, as a fraction of the component's width. */
  beamPosition: number;
  /**
   * An element the beam falls through on its way to the surface: the light runs around its edge,
   * and the beam leaves from its bottom edge. It gets `data-beam-source` while the beam passes
   * through it. When its centre leaves no clear path onto the surface, `beamPosition` applies.
   */
  source?: () => HTMLElement | undefined;
  /** Elements the beam must not cross. The beam moves right of them when the screen is narrow. */
  avoid?: () => readonly Element[];
  /** A six-digit hex colour. The whole palette is derived from its hue and saturation. */
  color: string;
  /** The beam waits for this before it falls in, for at most `MAX_HOLD_MS`. */
  start?: Promise<void>;
  /**
   * Called once, when the beam reaches the surface. It is called at once when the beam does not
   * fall in: with no WebGL2, with the reduced motion setting, or with no clear path onto the
   * surface.
   */
  onImpact?: () => void;
  class?: string;
}

export function LandingBeam(props: LandingBeamProps) {
  let container: HTMLDivElement | undefined;
  let canvas: HTMLCanvasElement | undefined;

  onSettled(() => {
    let impacted = false;
    const impact = () => {
      if (impacted) return;
      impacted = true;
      props.onImpact?.();
    };
    const host = container;
    const element = canvas;
    const gl = element?.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // A software renderer draws the shader on the CPU, and the whole page then drops to about 10 fps.
      failIfMajorPerformanceCaveat: true,
    });
    // No WebGL2 leaves the hero as it was without the beam, which is a complete page.
    if (!host || !element || !gl) {
      impact();
      return;
    }

    const program = buildProgram(gl);
    if (!program) {
      impact();
      return;
    }

    const uniforms = uniformLocations(gl, program);

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // One triangle that covers the whole canvas.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const cornerLocation = gl.getAttribLocation(program, "aCorner");
    gl.enableVertexAttribArray(cornerLocation);
    gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const reduce = prefersReducedMotion();
    const look = selectedLook(props.color);
    const settings = look.settings;
    // The seed is on the element, so a look that someone likes can be found and shown again.
    host.dataset.beam = look.seed;
    const drops = !reduce;
    if (!drops) impact();
    // The beam waits in the dark until the surface is ready, so the surface appears as the beam hits it.
    let held = drops && props.start !== undefined;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(holdTimer);
      held = false;
      wake();
    };
    if (held) void props.start?.then(release);
    const palette = buildPalette(look.color, look.hueSpread);
    // The button rim in CSS uses the main and hot colours, so that it agrees with the beam.
    const rgbOf = (index: number) =>
      Array.from(palette.subarray(index * 3, index * 3 + 3), (channel) => Math.round(channel * 255)).join(", ");
    const rimColors = { "--landing-beam-rim": rgbOf(1), "--landing-beam-edge": rgbOf(0) };
    const state = {
      clock: 0,
      /** Seconds since the beam started to fall. */
      age: drops ? 0 : SETTLE_TIME,
      width: 1,
      height: 1,
      ratio: 1,
      pointer: { x: 0, y: 0, inside: false },
      spot: { x: 0, y: 0, strength: 0, placed: false },
    };
    let observed: HTMLElement | undefined;
    let lit: HTMLElement | undefined;
    const light = (target: HTMLElement | undefined) => {
      if (target === lit) return;
      lit?.removeAttribute("data-beam-source");
      for (const name of Object.keys(rimColors)) lit?.style.removeProperty(name);
      target?.setAttribute("data-beam-source", "");
      for (const [name, value] of Object.entries(rimColors)) target?.style.setProperty(name, value);
      host.toggleAttribute("data-source", target !== undefined);
      lit = target;
    };
    let raf = 0;
    let last = 0;
    let visible = true;
    let alive = true;
    // A slow GPU first gets a smaller canvas. If the frames are still slow, the light stops moving.
    let quality = 1;
    let still = false;
    const intervals: number[] = [];

    const offscreen = (width: number, height: number): Surface => ({
      left: -width * 2,
      top: height,
      right: width * 3,
      bottom: height * 3,
      radius: 0,
      real: false,
    });

    const boxOf = (target: Element, origin: DOMRect): Box | undefined => {
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0) return undefined;
      const computed = getComputedStyle(target);
      const radius = Math.max(
        Number.parseFloat(computed.borderTopLeftRadius) || 0,
        Number.parseFloat(computed.borderTopRightRadius) || 0,
      );
      return {
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        right: rect.right - origin.left,
        bottom: rect.bottom - origin.top,
        radius: Math.min(radius, rect.width / 2, rect.height / 2),
      };
    };

    const measure = (origin: DOMRect): Surface => {
      const target = props.surface();
      if (target !== observed) {
        if (observed) resizeObserver.unobserve(observed);
        if (target) resizeObserver.observe(target);
        observed = target;
      }
      const box = target ? boxOf(target, origin) : undefined;
      return box ? { ...box, real: true } : offscreen(state.width, state.height);
    };

    /** Draws one frame. False when the text leaves the beam no clear path onto the surface. */
    const render = (): boolean => {
      const { width, height } = state;
      const unit = clamp(Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT), 0.5, 1.2);
      const origin = host.getBoundingClientRect();
      let surface = measure(origin);
      let beamX = props.beamPosition * width;
      let clear = 0;
      for (const avoided of props.avoid?.() ?? []) {
        clear = Math.max(clear, avoided.getBoundingClientRect().right - origin.left + BEAM_CLEARANCE);
      }
      beamX = Math.max(beamX, clear);
      const margin = surface.radius + 6;
      let source: Box | undefined;
      const emitter = props.source?.();
      const emitterBox = emitter ? boxOf(emitter, origin) : undefined;
      if (emitterBox) {
        const x = (emitterBox.left + emitterBox.right) / 2;
        if (surface.real && x >= clear && x >= surface.left + margin && x <= surface.right - margin) {
          source = emitterBox;
          beamX = x;
        }
      }
      light(source ? emitter : undefined);
      if (surface.real) {
        if (beamX > surface.right - margin) {
          // A beam that misses the preview is only a haze at the edge of the screen.
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          impact();
          return false;
        }
        if (beamX >= surface.left) beamX = clamp(beamX, surface.left + margin, surface.right - margin);
        else surface = offscreen(width, height);
      }

      // The head falls with a constant acceleration from above the canvas and reaches the top edge at DROP_TIME.
      const startY = -0.1 * height;
      const fallTo = (y: number) => DROP_TIME * Math.sqrt(clamp((y - startY) / (surface.top - startY), 0, 1));
      const age = state.age;
      const settled = age >= SETTLE_TIME;
      const sinceHit = age - DROP_TIME;
      if (sinceHit > 0) impact();
      const head = sinceHit > 0 ? height * 2 : startY + (surface.top - startY) * (age / DROP_TIME) ** 2;
      const glow = settled ? 1 : sinceHit <= 0 ? 0 : 1 - Math.exp(-sinceHit / 0.22);
      // The flash rises in 70 ms and is gone in about half a second.
      const flashAt = sinceHit / 0.07;
      const flash = settled || sinceHit <= 0 ? 0 : flashAt * Math.exp(1 - flashAt);
      const runTo = (since: number) =>
        settled ? 1e5 : since <= 0 ? 0 : ((RUN_SPEED * since) / (1 + since / RUN_SLOW)) * unit;

      // Only the side that is nearer to the beam drips, and a nearer corner gives a brighter drip.
      const toLeft = beamX - surface.left;
      const toRight = surface.right - beamX;
      const reach = settings.reach * 100 * unit;
      const dripStrength = (distance: number) => clamp(1.3 * Math.exp(-distance / (2.2 * reach)), 0, 1) * settings.drip;
      const dripDepth = (distance: number) => {
        if (settled) return 1e5;
        const since = sinceHit - runArrival(distance / unit);
        if (since <= 0) return 0;
        return (DRIP_SPEED * since + 0.5 * DRIP_ACCEL * since * since) * unit;
      };
      const leftNear = toLeft < toRight;
      const ringAt = source ? fallTo(source.top) : 0;
      const ring = settled ? 1e5 : Math.max(0, age - ringAt) * RING_SPEED * unit;
      const hazeRamp = settled ? 1 : sinceHit <= 0 ? 0.3 * (age / DROP_TIME) ** 2 : 1 - 0.7 * Math.exp(-sinceHit / 0.8);

      gl.viewport(0, 0, element.width, element.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform3f(uniforms.uView, element.width, element.height, state.ratio);
      gl.uniform1f(uniforms.uClock, state.clock);
      gl.uniform1f(uniforms.uUnit, unit);
      gl.uniform4f(uniforms.uBeam, beamX, head, glow, flash);
      gl.uniform4f(uniforms.uPanel, surface.left, surface.top, surface.right, surface.bottom);
      gl.uniform1f(uniforms.uRound, surface.radius);
      gl.uniform1f(uniforms.uRun, runTo(sinceHit));
      gl.uniform4f(
        uniforms.uDrip,
        leftNear ? dripDepth(toLeft) : 0,
        leftNear ? 0 : dripDepth(toRight),
        leftNear ? dripStrength(toLeft) : 0,
        leftNear ? 0 : dripStrength(toRight),
      );
      gl.uniform4f(uniforms.uButton, source?.left ?? 0, source?.top ?? 0, source?.right ?? 0, source?.bottom ?? 0);
      gl.uniform3f(uniforms.uButtonRing, source?.radius ?? 0, ring, source ? 1 : 0);
      gl.uniform3f(uniforms.uPointer, state.spot.x, state.spot.y, state.spot.strength);
      gl.uniform4f(uniforms.uLook, settings.brightness, settings.core, settings.glow, settings.reach);
      gl.uniform4f(uniforms.uGrain, settings.haze, settings.motes, settings.ripple, hazeRamp);
      gl.uniform2f(uniforms.uSeed, settings.seed * 5.3, settings.seed * 2.9);
      gl.uniform3fv(uniforms.uPalette, palette);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      return true;
    };

    const sizeCanvas = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const baseDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const longest = Math.max(width, height) * baseDpr;
      const ratio = (longest > MAX_RENDER_DIM ? (baseDpr * MAX_RENDER_DIM) / longest : baseDpr) * quality;
      const pixelWidth = Math.max(1, Math.round(width * ratio));
      const pixelHeight = Math.max(1, Math.round(height * ratio));
      if (element.width !== pixelWidth || element.height !== pixelHeight) {
        element.width = pixelWidth;
        element.height = pixelHeight;
      }
      state.width = width;
      state.height = height;
      state.ratio = element.width / width;
    };

    const resize = () => {
      sizeCanvas();
      render();
      // A wider window can open a path that a narrower one closed, and the loop stops while closed.
      wake();
    };

    /** Makes the canvas smaller, or stops the light, when the median of the recent frame times is slow. */
    const measureFrame = (gap: number) => {
      intervals.push(gap);
      if (intervals.length < FRAME_SAMPLES) return;
      intervals.sort((a, b) => a - b);
      const median = intervals[FRAME_SAMPLES >> 1] ?? 0;
      intervals.length = 0;
      if (median <= SLOW_FRAME_MS) return;
      if (quality > MIN_QUALITY) {
        quality = Math.max(MIN_QUALITY, quality * 0.7);
        sizeCanvas();
      } else {
        still = true;
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!alive || !visible || document.hidden) return;
      // The hold time starts on the first frame on screen. A page in a background tab does not load the surface.
      if (held && holdTimer === undefined) holdTimer = setTimeout(release, MAX_HOLD_MS);
      if (last && !held && !still) measureFrame(now - last);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const moving = !reduce && !still;
      if (moving) state.clock += dt * settings.speed;
      const introducing = state.age < SETTLE_TIME;
      if (introducing && !held) state.age = Math.min(SETTLE_TIME, state.age + dt);

      // The pointer light follows the pointer with a short lag, and fades in and out.
      const { pointer, spot } = state;
      const active = pointer.inside && !reduce;
      if (active && !spot.placed) {
        spot.x = pointer.x;
        spot.y = pointer.y;
        spot.placed = true;
      }
      const follow = 1 - Math.exp(-dt / 0.09);
      spot.x += (pointer.x - spot.x) * follow;
      spot.y += (pointer.y - spot.y) * follow;
      const goal = active ? 1 : 0;
      spot.strength += (goal - spot.strength) * (1 - Math.exp(-dt / (goal > spot.strength ? 0.25 : 0.5)));
      if (spot.strength < 0.001 && !active) spot.placed = false;

      const drawn = render();
      const settling =
        Math.abs(spot.strength - goal) > 0.002 || Math.hypot(pointer.x - spot.x, pointer.y - spot.y) > 0.5;
      if (drawn && (moving || introducing || settling)) raf = requestAnimationFrame(frame);
      else last = 0;
    };

    const wake = () => {
      if (!raf && alive && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      state.pointer.x = x;
      state.pointer.y = y;
      state.pointer.inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      wake();
    };

    const onPointerLeave = () => {
      state.pointer.inside = false;
      wake();
    };

    const onVisibility = () => {
      last = 0;
      wake();
    };

    // A lost context draws nothing again, so the beam stops and the source loses its light.
    const onContextLost = () => {
      alive = false;
      cancelAnimationFrame(raf);
      light(undefined);
      impact();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) {
        last = 0;
        wake();
      }
    });
    intersection.observe(host);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);
    element.addEventListener("webglcontextlost", onContextLost);
    resize();
    wake();

    return () => {
      alive = false;
      clearTimeout(holdTimer);
      cancelAnimationFrame(raf);
      light(undefined);
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      element.removeEventListener("webglcontextlost", onContextLost);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  });

  return (
    <div ref={container} class={cx("landing-beam", props.class)} aria-hidden="true">
      <canvas ref={canvas} class="landing-beam-canvas" />
    </div>
  );
}
