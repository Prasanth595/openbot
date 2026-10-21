/*
 * A SolidJS port of LaserFlow from React Bits (https://reactbits.dev/animations/laser-flow).
 * The image-reveal and light-theme options are removed; the landing page uses neither.
 *
 * MIT + Commons Clause License Condition v1.0
 *
 * Copyright (c) 2026 David Haz
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, and distribute the
 * Software as part of an application, website, or product, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * Commons Clause Restriction: You may use this Software, including for any commercial purpose, so
 * long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in
 * a bundle, or as a ported version.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
 * OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { cx, prefersReducedMotion } from "@openbot/ui/utils";
import { onSettled } from "solid-js";

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uScale;
uniform float uTime;
uniform float uBeamX;
uniform vec4 uSource;
uniform vec3 uWrap;
uniform float uFall;
uniform vec4 uSurface;
uniform float uRadius;
uniform vec3 uIntro;
uniform vec4 uPour;
uniform vec2 uRun;
uniform vec4 uLens;
uniform float uAtmosphere;
uniform vec4 uAmount;
uniform vec4 uShape;
uniform vec4 uExtra;
uniform vec3 uTint[16];

#define BEAM uTint[0]
#define LEFT uTint[1]
#define RIGHT uTint[2]
#define CYAN uTint[3]
#define PINK uTint[4]
#define LILAC uTint[5]
#define SKY uTint[6]
#define PURPLE uTint[7]
#define DEEP uTint[8]
#define MIST uTint[9]
#define NAVY uTint[10]
#define WARM uTint[11]
#define EMBER uTint[12]
#define WHITE uTint[13]
#define HAZE uTint[14]
#define LAVENDER uTint[15]

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

float sq(float x) {
  return x * x;
}

float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 spill(float e, float fall, float strength, float front, float t, out vec3 glow) {
  glow = vec3(0.0);
  if (strength < 0.0005) return vec3(0.0);
  // uFall stretches the light that runs down the side; the reveal front stays in real pixels.
  float fr = max(fall, 0.0);
  float f = fr / uFall;
  float d = max(e, 0.0);
  float u = d / (6.0 + 0.28 * f);
  float start = smoothstep(-6.0, 12.0, fall);
  float fade = exp(-sq(max(f - 125.0, 0.0) / 40.0));
  float streak = 0.88 + 0.24 * noise(vec2(u * 6.0, f / 22.0 - t * 1.7));
  float bright = pow(strength, 1.5);
  float soft = sqrt(strength);
  float warmth = smoothstep(90.0, 130.0, f);
  vec3 coreK = mix(WHITE, WARM, warmth * exp(-d / 9.0));
  float core = mix(9.0, 2.6, warmth) * exp(-sq(d / (3.5 + 0.04 * f))) * exp(-sq(max(f - 130.0, 0.0) / 38.0));
  float wall = 24.0 * exp(-sq(d / 1.1)) * exp(-sq(max(f - 100.0, 0.0) / 30.0));
  float bandCenter = 0.7 - 0.3 * smoothstep(30.0, 110.0, f);
  float offset = u - bandCenter;
  float decay = (1.05 - bandCenter) / 1.31;
  float profile = offset < 0.0 ? exp(-sq(offset / 0.3)) : exp(-offset / decay);
  profile *= 1.0 - smoothstep(1.0, 1.4, u);
  vec3 bandA = mix(CYAN, PINK, smoothstep(50.0, 75.0, f));
  bandA = mix(bandA, LILAC, smoothstep(100.0, 125.0, f));
  vec3 bandB = mix(SKY, PURPLE, smoothstep(50.0, 75.0, f));
  vec3 fanK = mix(bandA, bandB, smoothstep(0.06, 0.18, offset));
  fanK = mix(fanK, DEEP, smoothstep(0.22, 0.42, offset));
  vec3 thread = WHITE * wall * bright + coreK * core * streak * bright;
  glow += fanK * 4.5 * profile * fade * streak * bright;
  glow += MIST * 0.7 * exp(-max(u - 1.0, 0.0) / 0.9) * smoothstep(0.7, 1.2, u) * fade * soft;
  glow += EMBER * 0.35 * exp(-sq((f - 165.0) / 22.0)) * exp(-d / 25.0) * bright;
  float lag = u * (6.0 + 0.28 * f) * 0.35;
  float reveal = 1.0 - smoothstep(front - 70.0, front + 8.0, fr + lag);
  glow *= start * reveal;
  return thread * start * reveal;
}

vec3 easeLight(vec3 light, float amount) {
  return -log(max(1.0 - amount * (1.0 - exp(-light)), vec3(0.0001)));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uResolution.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 p = frag / uScale;
  float t = uTime;
  float bx = uBeamX / uScale;
  float sl = uSurface.x / uScale;
  float sy = uSurface.y / uScale;
  float sr = uSurface.z / uScale;
  float sb = uSurface.w / uScale;
  float radius = uRadius / uScale;
  float dx = p.x - bx;
  float adx = abs(dx);
  float h = sy - p.y;
  float hp = max(h, 0.0);
  float above = smoothstep(-0.5, 0.5, h);
  float side = smoothstep(-24.0, 24.0, dx);
  vec3 sideK = mix(mix(LAVENDER, LEFT, smoothstep(40.0, 140.0, adx)), RIGHT, side);
  float beamWidth = uShape.x;
  float flare = uShape.y;
  float spread = 250.0 * uShape.z;
  float reachL = max(bx - sl, 1.0);
  float reachR = max(sr - bx, 1.0);
  float reach = dx < 0.0 ? reachL : reachR;
  float layerLen = clamp(0.29 * reach, 20.0, 100.0) * sqrt(uShape.z);
  float run = uRun.x;
  float runMask = 1.0 - smoothstep(run - 34.0, run + 6.0, adx);
  float bead = exp(-sq((adx - run + 16.0) / (18.0 + 0.04 * run))) * uRun.y;
  float flowMask = (1.0 - smoothstep(0.75 * spread, 1.1 * spread, adx)) * runMask;
  float edgeMask = (1.0 - smoothstep(0.8 * spread, 1.25 * spread, adx)) * runMask;
  float bloom = uIntro.y;
  vec2 center = vec2((sl + sr) * 0.5, (sy + sb) * 0.5);
  vec2 halfSize = vec2((sr - sl) * 0.5, (sb - sy) * 0.5);
  float sd = roundBox(p - center, halfSize, radius);
  // Nothing is drawn inside the surface, and the app preview covers most of the hero.
  if (sd * uScale < -0.75) {
    outColor = vec4(0.0);
    return;
  }
  float outline = max(sd, 0.0);
  float below = max(p.y - sy - radius, 0.0);
  float hug = smoothstep(-0.5, 0.5, sd) * exp(-sq(below / 14.0));
  float hugWide = smoothstep(-0.5, 0.5, sd) * exp(-sq(below / 40.0));

  vec3 col = vec3(0.0);

  float breathe = 1.0 + uExtra.x * (0.12 * sin(t * 1.5708) + 0.08 * (noise(vec2(t * 0.5, 3.0)) - 0.5));

  float front = uIntro.x / uScale;
  float drop = smoothstep(front + 10.0, front - 110.0, p.y);
  float falling = 1.0 - smoothstep(sy - 24.0, sy, front);
  // A source element sits near the top of the canvas, so the beam is at full strength sooner.
  float sourced = uWrap.z;
  float top = mix(mix(0.3, 0.6, sourced), 1.0, smoothstep(0.0, 0.3 * sy, p.y));
  // A wide beam keeps a thin core: only its glow grows, so the beam does not turn into a white column.
  float beamCore = 24.0 * exp(-adx / (2.0 * min(beamWidth, 1.9)));
  float beamHalo = 1.3 * exp(-adx / (6.0 * min(beamWidth, 2.1))) + 0.3 * exp(-adx / (22.0 * beamWidth));
  vec3 haloK = mix(BEAM, sideK, exp(-hp / 80.0));
  col += (BEAM * beamCore + haloK * beamHalo) * top * above * drop;
  col += sideK * 0.16 * exp(-adx / (45.0 * beamWidth)) * top * above * drop;
  if (sourced > 0.5) {
    // The beam falls onto the source element, its light runs around the element's edge, and the
    // beam leaves again from the element's bottom edge.
    vec4 sb4 = uSource / uScale;
    vec2 sc = vec2(sb4.x + sb4.z, sb4.y + sb4.w) * 0.5;
    float sdS = roundBox(p - sc, vec2(sb4.z - sb4.x, sb4.w - sb4.y) * 0.5, uWrap.x / uScale);
    float outS = max(sdS, 0.0);
    float struck = smoothstep(sb4.y - 4.0, sb4.y + 12.0, front);
    float around = 1.0 - smoothstep(uWrap.y / uScale - 24.0, uWrap.y / uScale, adx);
    float near = 0.4 + 0.6 * exp(-adx / 28.0);
    float wrapLine = (exp(-sq(outS / 0.9)) + 0.15 * exp(-outS / 3.0)) * 9.0 * near;
    float wrapHalo = (exp(-outS / 7.0) + 0.35 * exp(-outS / 22.0)) * 1.1 * near;
    col += (mix(sideK, WHITE, 0.6) * wrapLine + sideK * wrapHalo) * struck * around * breathe * smoothstep(-0.5, 0.5, sdS);
    float mouth = exp(-length(vec2(dx / 2.2, max(p.y - sb4.w, 0.0))) / 9.0) * smoothstep(sb4.w - 3.0, sb4.w + 6.0, p.y);
    col += mix(WHITE, BEAM, 0.3) * mouth * 7.0 * drop;
  }
  float head = exp(-sq((p.y - front) / 24.0)) * falling;
  col += mix(WHITE, BEAM, 0.35) * head * (7.0 * exp(-adx / (2.6 * beamWidth)) + 1.0 * exp(-adx / (14.0 * beamWidth)));

  float psi = adx * (outline + 1.0);
  float rise = max(hp - 17.9 * flare, 0.0);
  float skirtAmp = 16.6 * (exp(-sq(rise / (11.8 * flare))) + 0.3 * exp(-rise / (60.0 * flare)));
  float skirtSpread = mix(134.0, 155.0, side) * breathe * flare * flare * mix(0.35, 1.0, min(bloom, 1.0)) * max(bloom, 1.0);
  float skirt = skirtAmp * exp(-psi / skirtSpread) * exp(-sq(adx / (max(layerLen, 60.0 * sqrt(uShape.z)) * 1.48))) * hug;
  col += sideK * skirt * flowMask * min(bloom, 1.0);

  float layer = 12.0 * exp(-adx / layerLen) * exp(-outline / (0.19 * layerLen)) * (1.0 + 0.4 * bead);
  col += sideK * layer * hug * flowMask * min(bloom, 1.0);
  float washMask = smoothstep(sl - 60.0, sl + 6.0, p.x) * (1.0 - smoothstep(sr - 6.0, sr + 45.0, p.x));
  float wash = 1.4 * exp(-adx / 100.0) * exp(-outline / 30.0);
  col += mix(BEAM, sideK, 0.25) * wash * hugWide * washMask * flowMask * min(bloom, 1.0);
  float highWash = 0.7 * exp(-adx / 140.0) * exp(-outline / 60.0);
  col += mix(BEAM, NAVY, 0.5) * highWash * hugWide * washMask * runMask * min(bloom, 1.0);

  float sideSign = dx < 0.0 ? 0.0 : 1.0;
  float along = 0.5 * log((hp + 1.0) / (adx + 1.0));
  float lineScale = 6.0;
  float lp = log(max(psi, 1.0) / (120.0 * flare * flare)) * lineScale;
  float lineIndex = floor(lp) + sideSign * 97.0;
  float wobble = 0.22 * (noise(vec2(lineIndex * 3.7, t * 0.4 + along)) - 0.5);
  float lf = fract(lp + wobble) - 0.5;
  float gradient = lineScale * length(vec2(hp + 1.0, adx)) / max(psi, 1.0) / uScale;
  float halfWidth = max(0.35 * gradient, 0.0001);
  float drawWidth = max(halfWidth, 0.6 * gradient);
  float lineShape = exp(-lf * lf / (drawWidth * drawWidth)) * (halfWidth / drawWidth);
  float lineOn = step(0.3, hash(vec2(lineIndex, 1.3)));
  float lineFlow = smoothstep(0.25, 0.85, noise(vec2(lineIndex * 5.3 + 2.0, along * 3.0 + t * 1.1)));
  float flareArea = 120.0 * flare * flare;
  float lineEnvelope = smoothstep(0.85 * flareArea, 1.4 * flareArea, psi) * (1.0 - smoothstep(3.2 * flareArea, 7.5 * flareArea, psi));
  lineEnvelope *= exp(-adx / (layerLen * 1.5)) * hug * flowMask * (1.0 - smoothstep(35.0 * flare, 80.0 * flare, hp));
  float lineBright = mix(0.35, 1.0, hash(vec2(lineIndex, 4.0)));
  col += mix(sideK, WHITE, 0.6) * lineShape * lineOn * lineFlow * lineEnvelope * lineBright * 2.6 * uAmount.w * min(bloom, 1.0);

  float edgeGlow = 22.8 * exp(-sq(adx / (150.0 * uShape.z))) * edgeMask * (1.0 + 0.9 * bead);
  float onTop = 1.0 - smoothstep(sy + radius, sy + radius + 10.0, p.y);
  float edgeLine = (exp(-sq(max(sd, 0.0) / 0.9)) + 0.12 * exp(-max(sd, 0.0) / 3.0)) * edgeGlow * onTop;
  col += mix(sideK, WHITE, 0.6) * edgeLine * min(bloom, 1.0);

  float pour = uShape.w;
  float baseline = exp(-sq(130.0 / 150.0));
  float strengthR = exp(-sq(reachR / (150.0 * uShape.z))) * (1.0 - smoothstep(0.8 * spread, 1.25 * spread, reachR)) / baseline * pour;
  float strengthL = exp(-sq(reachL / (150.0 * uShape.z))) * (1.0 - smoothstep(0.8 * spread, 1.25 * spread, reachL)) / baseline * pour;
  float fallY = p.y - sy - 0.3 * radius;
  float rightHalf = smoothstep(center.x - 4.0, center.x + 4.0, p.x);
  float haloR = exp(-length(p - vec2(sr - 0.3 * radius, sy + 0.3 * radius)) / 40.0) * sqrt(strengthR);
  float haloL = exp(-length(p - vec2(sl + 0.3 * radius, sy + 0.3 * radius)) / 40.0) * sqrt(strengthL);
  vec3 glowR;
  vec3 glowL;
  col += spill(sd, fallY, strengthR, uPour.y, t, glowR) * rightHalf;
  col += spill(sd, fallY, strengthL, uPour.x, t, glowL) * (1.0 - rightHalf);
  col += easeLight(glowR * rightHalf + NAVY * 0.9 * haloR, uPour.w);
  col += easeLight(glowL * (1.0 - rightHalf) + NAVY * 0.9 * haloL, uPour.z);

  vec2 toLens = frag - uLens.xy;
  float lens = exp(-dot(toLens, toLens) / sq(uLens.z)) * uLens.w;
  col *= 1.0 + 0.35 * lens * hug;
  float fogAmount = uAmount.y * uAtmosphere;
  float near = exp(-adx / 150.0);
  float envelope = near * (0.3 + 0.4 * exp(-hp / 50.0) + 1.2 * exp(-p.y / 120.0));
  if (fogAmount > 0.001 && h > -2.0 && envelope * max(0.25, 6.0 * exp(-adx / 50.0)) > 0.002) {
    vec2 fq = vec2(dx / 1.7, h) / 85.0 + vec2(t * 0.012, -t * 0.03) + uExtra.zw;
    vec2 fw = vec2(fbm(fq * 1.3 + vec2(1.7, 9.2) + t * 0.03), fbm(fq * 1.3 + vec2(8.3, 2.8) - t * 0.025));
    float cloud = fbm(fq + 1.4 * fw);
    float density = smoothstep(0.5, 0.78, cloud);
    float lit = exp(-adx / 50.0);
    float fogMask = smoothstep(-2.0, 20.0, h);
    float reached = smoothstep(front + 80.0, front - 40.0, p.y);
    vec3 fog = (HAZE * 0.45 + BEAM * 6.0 * lit * reached) * density * envelope * fogMask;
    float surfaceLit = exp(-adx / (layerLen * 1.3)) * exp(-outline / 28.0) * hugWide * flowMask * washMask * min(bloom, 1.0);
    fog += sideK * 2.2 * surfaceLit * (smoothstep(0.38, 0.72, cloud) - 0.35) * fogMask;
    float smoke = smoothstep(0.3, 0.75, cloud);
    fog += BEAM * 0.35 * exp(-adx / (22.0 * beamWidth)) * (0.35 + 0.9 * smoke) * fogMask * top * drop;
    col += fog * fogAmount * (1.0 + 1.2 * lens);
  }

  float haze = col.b;
  float dotGrid = 1.0 - smoothstep(0.16, 0.32, length(fract(frag / 3.0) - 0.5));
  col += BEAM * dotGrid * clamp(haze, 0.0, 1.5) * (1.0 - smoothstep(1.5, 4.0, haze)) * (0.18 + 0.3 * lens) * uExtra.y;
  if (lens > 0.002) {
    vec2 drift = frag - vec2(0.0, t * 14.0);
    vec2 sparkCell = floor(drift / 7.0);
    vec2 sparkPos = (sparkCell + 0.2 + 0.6 * vec2(hash(sparkCell + 5.1), hash(sparkCell + 2.3))) * 7.0;
    float sparkDist = length(drift - sparkPos);
    float sparkOn = step(0.8, hash(sparkCell + 8.8));
    float sparkTwinkle = 0.5 + 0.5 * sin(t * 5.0 + hash(sparkCell + 3.7) * 6.283);
    col += WHITE * exp(-sparkDist * sparkDist / 0.35) * sparkOn * sparkTwinkle * lens * clamp(haze * 1.5, 0.0, 1.0) * 1.6 * uAmount.z;
  }

  float dustAmount = uAmount.z;
  if (dustAmount > 0.001) {
    float dustLp = log(max(psi, 1.0) / (120.0 * flare * flare)) * 2.2;
    vec2 flowCell = vec2(dustLp / 1.1, (along + t * 0.22) / 0.06);
    vec2 cellId = floor(flowCell) + vec2(sideSign * 131.0, 0.0);
    vec2 cellJitter = vec2(hash(cellId + 1.7), hash(cellId + 8.3));
    vec2 particleFlow = (floor(flowCell) + 0.1 + cellJitter * 0.8) * vec2(1.1, 0.06);
    float particlePsi = 120.0 * flare * flare * exp(particleFlow.x / 2.2);
    float particleAlong = particleFlow.y - t * 0.22;
    float particleX = sqrt(particlePsi * exp(-2.0 * particleAlong)) - 1.0;
    float particleH = sqrt(particlePsi * exp(2.0 * particleAlong)) - 1.0;
    float particleDist = length(vec2(adx - particleX, hp - particleH)) * uScale;
    float particleOn = step(0.62, hash(cellId + 3.1));
    float particleTwinkle = 0.5 + 0.5 * sin(t * 5.0 + hash(cellId + 9.2) * 6.283);
    float dustZone = exp(-sq(log(max(psi, 1.0) / (200.0 * flare * flare)) / 0.55)) * hug * flowMask * smoothstep(0.0, 6.0, outline);
    col += WHITE * exp(-particleDist * particleDist / 0.3) * particleOn * particleTwinkle * dustZone * 3.0 * dustAmount * min(bloom, 1.0);

    vec2 glitterCell = vec2(dx / 3.0, (p.y - t * 26.0) / 9.0);
    vec2 glitterId = floor(glitterCell);
    vec2 glitterJitter = vec2(hash(glitterId + 4.4), hash(glitterId + 2.9));
    vec2 glitterPos = (glitterId + 0.15 + glitterJitter * 0.7) * vec2(3.0, 9.0);
    float glitterDist = length(vec2(dx, p.y - t * 26.0) - glitterPos) * uScale;
    float glitterOn = step(0.7, hash(glitterId + 6.6));
    float glitterTwinkle = 0.5 + 0.5 * sin(t * 6.0 + hash(glitterId + 1.1) * 6.283);
    float glitterZone = exp(-adx / (5.0 * beamWidth)) * smoothstep(1.5, 4.0, adx / beamWidth) * above * smoothstep(25.0, 70.0, hp) * top * drop;
    col += WHITE * exp(-glitterDist * glitterDist / 0.25) * glitterOn * glitterTwinkle * glitterZone * 2.2 * dustAmount * uAtmosphere;
  }

  col *= uAmount.x * (1.0 + uIntro.z * 0.9 * exp(-length(vec2(dx, h * 1.6)) / 70.0));
  col *= smoothstep(-0.75, 0.25, sd * uScale);

  vec3 emit = 1.0 - exp(-col);
  outColor = vec4(emit, max(emit.r, max(emit.g, emit.b)));
}`;

type Rgb = readonly [number, number, number];

/** Hue shift in degrees and saturation scale for each palette entry the shader reads. */
const TINTS: readonly (readonly [number, number])[] = [
  [0, 1],
  [-11.5, 0.77],
  [9.5, 0.95],
  [-53.5, 0.79],
  [39.5, 0.77],
  [16, 0.81],
  [-16.3, 0.92],
  [13.3, 0.96],
  [3, 1.01],
  [1, 0.68],
  [1, 1.15],
  [142.5, 0.51],
  [113.6, 0.28],
  [-7.5, 0.13],
  [-2.7, 0.32],
  [7.5, 0.81],
];

const BASE_SATURATION = 0.78;
// The hero is wide and tall, and the fragment shader is heavy. A lower ceiling than React Bits'
// 2048 keeps the frame time down on large retina screens; the light is soft, so it shows no loss.
const MAX_RENDER_DIM = 1600;
const MAX_DPR = 1.5;
// React Bits sizes the light to the canvas. The hero canvas is far larger than its demo, and at
// full size the haze covers the headline, so the light stops growing at this scale.
const MAX_SCALE = 1.25;
/** The gap, in CSS pixels, between the beam and the text it must not cross. */
const BEAM_CLEARANCE = 56;
const INTRO_DROP = 1.25;
/** The light that runs along the surface and spills down its sides moves at this share of the source speed. */
const POUR_PACE = 0.5;
/** The light falls down the sides slower than it runs along the top, so it drips rather than drops. */
const SPILL_SPEED = 150;
const SPILL_GRAVITY = 90;
const INTRO_END = 12;
/** How fast, in CSS pixels a second, the light runs around the source element after the beam reaches it. */
const WRAP_SPEED = 240;

const SETTINGS = {
  intensity: 1.6,
  beamWidth: 3.2,
  flare: 2.5,
  spread: 3.8,
  spill: 1,
  /** How far the light runs down the sides of the surface, as a multiple of the React Bits length. */
  fall: 1.3,
  fog: 0.3,
  dust: 1.4,
  streaks: 1.4,
  dots: 0.8,
  pulse: 1.4,
  speed: 1.2,
  seed: 3,
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const easeOut = (x: number) => 1 - (1 - clamp(x, 0, 1)) ** 3;
const spring = (time: number) => {
  const omega = 8;
  const zeta = 0.62;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return (
    1 - Math.exp(-zeta * omega * time) * (Math.cos(damped * time) + ((zeta * omega) / damped) * Math.sin(damped * time))
  );
};

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

function fromHsv(hue: number, saturation: number): Rgb {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = saturation;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = 1 - c;
  const [r, g, b] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

function buildTints(rgb: Rgb): Float32Array {
  const [hue, saturation] = toHsv(rgb);
  const strength = saturation / BASE_SATURATION;
  const data = new Float32Array(TINTS.length * 3);
  TINTS.forEach(([shift, scale], index) => {
    data.set(fromHsv(hue + shift, clamp(BASE_SATURATION * scale * strength, 0, 1)), index * 3);
  });
  return data;
}

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

function link(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
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

function locate(gl: WebGL2RenderingContext, program: WebGLProgram) {
  const at = (name: string) => gl.getUniformLocation(program, name);
  return {
    uResolution: at("uResolution"),
    uDpr: at("uDpr"),
    uScale: at("uScale"),
    uTime: at("uTime"),
    uBeamX: at("uBeamX"),
    uSource: at("uSource"),
    uWrap: at("uWrap"),
    uFall: at("uFall"),
    uSurface: at("uSurface"),
    uRadius: at("uRadius"),
    uIntro: at("uIntro"),
    uPour: at("uPour"),
    uRun: at("uRun"),
    uLens: at("uLens"),
    uAtmosphere: at("uAtmosphere"),
    uAmount: at("uAmount"),
    uShape: at("uShape"),
    uExtra: at("uExtra"),
    uTint: at("uTint"),
  };
}

interface Surface {
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
  real: boolean;
}

export interface LandingLaserFlowProps {
  /** The element the beam lands on. The light runs along its top edge and spills down its sides. */
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
  class?: string;
}

export function LandingLaserFlow(props: LandingLaserFlowProps) {
  let container: HTMLDivElement | undefined;
  let canvas: HTMLCanvasElement | undefined;

  onSettled(() => {
    const host = container;
    const element = canvas;
    const gl = element?.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    // No WebGL2 leaves the hero as it was without the beam, which is a complete page.
    if (!host || !element || !gl) return;

    const program = link(gl);
    if (!program) return;

    const uniforms = locate(gl, program);

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const positionLocation = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const reduce = prefersReducedMotion();
    const tints = buildTints(hexToRgb(props.color));
    const state = {
      time: 0,
      introTime: reduce ? INTRO_END : 0,
      width: 1,
      height: 1,
      ratio: 1,
      pointer: { x: 0, y: 0, inside: false },
      lens: { x: 0, y: 0, vx: 0, vy: 0, strength: 0, placed: false },
    };
    let observed: HTMLElement | undefined;
    let lit: HTMLElement | undefined;
    const light = (target: HTMLElement | undefined) => {
      if (target === lit) return;
      lit?.removeAttribute("data-beam-source");
      target?.setAttribute("data-beam-source", "");
      host.toggleAttribute("data-source", target !== undefined);
      lit = target;
    };
    let raf = 0;
    let last = 0;
    let visible = true;
    let alive = true;

    const measure = (width: number, height: number): Surface => {
      const target = props.surface();
      if (target !== observed) {
        if (observed) resizeObserver.unobserve(observed);
        if (target) resizeObserver.observe(target);
        observed = target;
      }
      if (target) {
        const box = host.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        if (rect.width > 0) {
          const computed = getComputedStyle(target);
          const radius = Math.max(
            Number.parseFloat(computed.borderTopLeftRadius) || 0,
            Number.parseFloat(computed.borderTopRightRadius) || 0,
          );
          return {
            left: rect.left - box.left,
            top: rect.top - box.top,
            right: rect.right - box.left,
            bottom: rect.bottom - box.top,
            radius: Math.min(radius, rect.width / 2, rect.height / 2),
            real: true,
          };
        }
      }
      return { left: -width * 2, top: height, right: width * 3, bottom: height * 3, radius: 0, real: false };
    };

    /** Draws one frame. False when the text leaves the beam no clear path onto the surface. */
    const render = (): boolean => {
      const { width, height } = state;
      const scale = clamp(Math.min(width / 585, height / 507), 0.2, MAX_SCALE);
      let surface = measure(width, height);
      let beamX = props.beamPosition * width;
      const box = host.getBoundingClientRect();
      let clear = 0;
      for (const avoided of props.avoid?.() ?? []) {
        clear = Math.max(clear, avoided.getBoundingClientRect().right - box.left + BEAM_CLEARANCE);
      }
      beamX = Math.max(beamX, clear);
      const margin = surface.radius + 6;
      let source: { x: number; left: number; top: number; right: number; bottom: number; radius: number } | undefined;
      const emitter = props.source?.();
      const rect = emitter?.getBoundingClientRect();
      if (emitter && rect && rect.width > 0) {
        const x = (rect.left + rect.right) / 2 - box.left;
        if (surface.real && x >= clear && x >= surface.left + margin && x <= surface.right - margin) {
          const radius = Number.parseFloat(getComputedStyle(emitter).borderTopLeftRadius) || 0;
          source = {
            x,
            left: rect.left - box.left,
            top: rect.top - box.top,
            right: rect.right - box.left,
            bottom: rect.bottom - box.top,
            radius: Math.min(radius, rect.width / 2, rect.height / 2),
          };
          beamX = x;
        }
      }
      light(source ? emitter : undefined);
      if (surface.real) {
        if (beamX > surface.right - margin) {
          // A beam that misses the preview is only a haze at the edge of the screen.
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          return false;
        }
        if (beamX >= surface.left) {
          beamX = clamp(beamX, surface.left + margin, surface.right - margin);
        } else {
          surface = { left: -width * 2, top: height, right: width * 3, bottom: height * 3, radius: 0, real: false };
        }
      }
      const startY = -0.15 * height;
      const span = surface.top - startY + 0.3 * height;
      const it = state.introTime;
      const settled = it >= INTRO_END;
      const front = settled ? surface.top + 0.3 * height : startY + span * clamp(it / INTRO_DROP, 0, 1) ** 1.3;
      const impact = INTRO_DROP * (Math.max(0, surface.top - startY) / span) ** (1 / 1.3);
      const tau = it - impact;
      const bloom = settled ? 1 : tau <= 0 ? 0 : spring(tau);
      const flash = settled || tau <= 0 ? 0 : Math.exp(-tau / 0.35) * (1 - Math.exp(-tau / 0.05));
      const runRange = SETTINGS.spread * 250 * 1.3 + 80;
      const flow = tau * POUR_PACE;
      const runFront = settled ? 100000 : tau <= 0 ? -40 : runRange * (1 - Math.exp(-1.15 * flow));
      const beadStrength = settled || tau <= 0 ? 0 : Math.exp(-1.15 * flow) * (1 - Math.exp(-flow / 0.08));
      const pour = (reach: number): [number, number] => {
        if (settled) return [1000, 1];
        if (tau <= 0) return [-reach, 0];
        const target = Math.min(reach, runRange * 0.97);
        const arrival = -Math.log(1 - target / runRange) / 1.15;
        const elapsed = flow - arrival;
        const ease = clamp((elapsed + 0.15) / 0.8, 0, 1);
        const fill = ease * ease * ease * (ease * (ease * 6 - 15) + 10);
        if (elapsed <= 0) return [runFront - target, fill];
        const speed = Math.min(1.15 * (runRange - target), SPILL_SPEED);
        return [speed * elapsed + SPILL_GRAVITY * elapsed * elapsed, fill];
      };
      const [frontL, fillL] = pour((beamX - surface.left) / scale);
      const [frontR, fillR] = pour((surface.right - beamX) / scale);
      // The light runs out from the top centre of the source once the beam front reaches it.
      const struck = source ? INTRO_DROP * clamp((source.top - startY) / span, 0, 1) ** (1 / 1.3) : 0;
      const wrapRun = settled ? 100000 : Math.max(0, it - struck) * WRAP_SPEED;
      const atmosphere = settled
        ? 1
        : tau <= 0
          ? 0.3 * easeOut(it / INTRO_DROP)
          : 0.3 + 0.7 * (1 - Math.exp(-1.3 * flow));

      gl.viewport(0, 0, element.width, element.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uniforms.uResolution, width, height);
      gl.uniform1f(uniforms.uDpr, state.ratio);
      gl.uniform1f(uniforms.uScale, scale);
      gl.uniform1f(uniforms.uTime, state.time);
      gl.uniform1f(uniforms.uBeamX, beamX);
      gl.uniform4f(uniforms.uSource, source?.left ?? 0, source?.top ?? 0, source?.right ?? 0, source?.bottom ?? 0);
      gl.uniform3f(uniforms.uWrap, source?.radius ?? 0, wrapRun, source ? 1 : 0);
      gl.uniform1f(uniforms.uFall, SETTINGS.fall);
      gl.uniform4f(uniforms.uSurface, surface.left, surface.top, surface.right, surface.bottom);
      gl.uniform1f(uniforms.uRadius, surface.radius);
      gl.uniform3f(uniforms.uIntro, front, bloom, flash);
      gl.uniform4f(uniforms.uPour, frontL, frontR, fillL, fillR);
      gl.uniform2f(uniforms.uRun, runFront, beadStrength);
      gl.uniform4f(uniforms.uLens, state.lens.x, state.lens.y, 95 * scale, state.lens.strength);
      gl.uniform1f(uniforms.uAtmosphere, atmosphere);
      gl.uniform4f(uniforms.uAmount, SETTINGS.intensity, SETTINGS.fog, SETTINGS.dust, SETTINGS.streaks);
      gl.uniform4f(uniforms.uShape, SETTINGS.beamWidth, SETTINGS.flare, SETTINGS.spread, SETTINGS.spill);
      gl.uniform4f(
        uniforms.uExtra,
        SETTINGS.pulse,
        SETTINGS.dots,
        34.34 + SETTINGS.seed * 7.31,
        11.58 + SETTINGS.seed * 3.17,
      );
      gl.uniform3fv(uniforms.uTint, tints);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      return true;
    };

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const baseDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const longest = Math.max(width, height) * baseDpr;
      const ratio = longest > MAX_RENDER_DIM ? (baseDpr * MAX_RENDER_DIM) / longest : baseDpr;
      const pixelWidth = Math.max(1, Math.round(width * ratio));
      const pixelHeight = Math.max(1, Math.round(height * ratio));
      if (element.width !== pixelWidth || element.height !== pixelHeight) {
        element.width = pixelWidth;
        element.height = pixelHeight;
      }
      state.width = width;
      state.height = height;
      state.ratio = element.width / width;
      render();
      // A wider window can open a path that a narrower one closed, and the loop stops while closed.
      wake();
    };

    const frame = (now: number) => {
      raf = 0;
      if (!alive || !visible || document.hidden) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const moving = !reduce;
      if (moving) state.time += dt * SETTINGS.speed;
      const introducing = state.introTime < INTRO_END;
      if (introducing) state.introTime = Math.min(INTRO_END, state.introTime + dt);

      const { pointer, lens } = state;
      const active = pointer.inside && !reduce;
      if (active && !lens.placed) {
        lens.x = pointer.x;
        lens.y = pointer.y;
        lens.vx = 0;
        lens.vy = 0;
        lens.placed = true;
      }
      const ax = 120 * (pointer.x - lens.x) - 19 * lens.vx;
      const ay = 120 * (pointer.y - lens.y) - 19 * lens.vy;
      lens.vx += ax * dt;
      lens.vy += ay * dt;
      lens.x += lens.vx * dt;
      lens.y += lens.vy * dt;
      const goal = active ? 1 : 0;
      lens.strength += (goal - lens.strength) * (1 - Math.exp(-dt / (goal > lens.strength ? 0.3 : 0.55)));
      if (lens.strength < 0.001 && !active) lens.placed = false;

      const drawn = render();
      const settling = Math.abs(lens.strength - goal) > 0.002 || Math.hypot(lens.vx, lens.vy) > 0.5;
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
    resize();
    wake();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      light(undefined);
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  });

  return (
    <div ref={container} class={cx("landing-laser-flow", props.class)} aria-hidden="true">
      <canvas ref={canvas} class="landing-laser-flow-canvas" />
    </div>
  );
}
