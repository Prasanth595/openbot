// The network picture of the landing page: three agents pass one task through
// OpenBot, then the network grows around them until it fills the frame.
//
// The scene is a pure function of time. `buildAgentNetwork` places every node,
// edge and message once from a seed, and `drawAgentNetwork` draws the
// frame at second `t`. Playback, pause and reduced motion are only a choice of
// `t`, so they cannot drift apart.

import { APP_LOGO_CORNER, APP_LOGO_EYE_POINTS, APP_LOGO_SIZE } from "@openbot/brand/app-logo-shape";

/** A node with no avatar is the OpenBot mark at the centre. */
const HUB = -1;

interface NetworkNode {
  x: number;
  y: number;
  /** The second at which the node appears. */
  at: number;
  radius: number;
  /** An index in `NetworkAssets.avatars`, or `HUB`. */
  avatar: number;
  /** An index in `NetworkAssets.marks`, or -1 for no badge. */
  mark: number;
  label?: string;
  /** Busy nodes show the typing pill from time to time. */
  busy: boolean;
  phase: number;
}

interface NetworkEdge {
  from: number;
  to: number;
  /** The second at which the dots start to draw from `from` to `to`. */
  at: number;
  /** The dot centres, from `from` to `to`, in world units. */
  dots: Float32Array;
  length: number;
}

interface NetworkMessage {
  node: number;
  text: string;
  at: number;
  until: number;
}

interface NetworkPulse {
  edge: number;
  /** True when the pulse runs from `to` to `from`. */
  reverse: boolean;
  at: number;
  duration: number;
  /** The node whose colour the pulse carries. */
  sender: number;
}

export interface AgentNetwork {
  nodes: readonly NetworkNode[];
  /** In the order in which they start to draw. */
  edges: readonly NetworkEdge[];
  messages: readonly NetworkMessage[];
  pulses: readonly NetworkPulse[];
  /** The second at which the network is complete and the camera is still. */
  end: number;
  /** Moves the background pulses to other slots, so they differ with the seed too. */
  salt: number;
}

export interface AgentNetworkAgent {
  label: string;
  avatar: number;
  mark: number;
}

export interface AgentNetworkInput {
  /** The three agents of the conversation, in the order in which they talk. */
  agents: readonly [AgentNetworkAgent, AgentNetworkAgent, AgentNetworkAgent];
  /** One message for each agent, in the same order. */
  messages: readonly [string, string, string];
  hubLabel: string;
  /** Each seed grows a different network around the same story. */
  seed: number;
  /** How many avatars and provider marks the grown network chooses from. */
  avatarCount: number;
  markCount: number;
}

export interface NetworkAssets {
  avatars: readonly (CanvasImageSource | undefined)[];
  /** The head colour of each avatar, which its pulses carry. */
  avatarColors: readonly string[];
  marks: readonly (CanvasImageSource | undefined)[];
  font: string;
  colors: {
    hub: string;
    hubEye: string;
    dot: string;
    badge: string;
    /** The page colour: a ring in it keeps a badge apart from its avatar. */
    canvas: string;
    bubble: string;
    bubbleBorder: string;
    bubbleText: string;
    label: string;
    hubPulse: string;
  };
}

export interface NetworkView {
  /** CSS pixels. */
  width: number;
  height: number;
  /** The heading covers this many pixels at the top. The scene centres in the space under it. */
  top: number;
  /** Narrow frames keep one message at a time, so the bubbles do not cover each other. */
  narrow: boolean;
}

// The timeline, in seconds.
const NODE_POP = 0.38;
const EDGE_DRAW = 0.24;
const GROW_START = 5.3;
const GROW_DURATION = 4.4;
const ZOOM_START = 5.1;
const ZOOM_DURATION = 5;

// The world, in units that are CSS pixels at the first camera scale.
const AGENT_RADIUS = 34;
const GROWN_RADIUS = 28;
const HUB_SIDE = 78;
const DOT_SPACING = 15;
const DOT_RADIUS = 3;
/** Screen pixels. */
const BADGE_MIN_RADIUS = 8;
const PULSE_TRAIL = 5;
const PULSE_SPEED = 420;
const WORLD_RX = 1700;
const WORLD_RY = 1000;
const MAX_GROWN = 320;
/** The story fits in this box at the first camera scale. A narrow frame lets the bubbles reach its sides. */
const STORY_WIDTH = 1080;
const NARROW_STORY_WIDTH = 800;
const STORY_HEIGHT = 600;
const STORY_CENTRE = { x: -20, y: -30 };

// Background pulses run on a fixed grid of slots, so a frame needs no state.
const AMBIENT_SLOT = 0.035;
const AMBIENT_MAX_DURATION = 0.7;

/** A small seeded generator (mulberry32), so one seed always grows the same network. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable value in [0, 1) for slot `index`. */
function hash(index: number): number {
  let value = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;
const easeInOutCubic = (value: number) => (value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2);
const easeOutBack = (value: number) => 1 + 2.2 * (value - 1) ** 3 + 1.2 * (value - 1) ** 2;

function nodeReach(node: NetworkNode): number {
  return node.avatar === HUB ? (HUB_SIDE / 2) * 1.15 : node.radius;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function makeEdge(nodes: readonly NetworkNode[], from: number, to: number, at: number): NetworkEdge {
  const a = nodes[from];
  const b = nodes[to];
  if (!a || !b) throw new Error("A network edge names a node that does not exist.");
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const start = nodeReach(a) + 9;
  const span = length - start - nodeReach(b) - 9;
  const count = Math.max(2, Math.floor(span / DOT_SPACING) + 1);
  const step = span / (count - 1);
  const dots = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    dots[index * 2] = a.x + ux * (start + step * index);
    dots[index * 2 + 1] = a.y + uy * (start + step * index);
  }
  return { from, to, at, dots, length };
}

export function buildAgentNetwork(input: AgentNetworkInput): AgentNetwork {
  const next = random(input.seed);
  const [first, second, third] = input.agents;
  const nodes: NetworkNode[] = [
    { x: 0, y: 0, at: 0.05, radius: HUB_SIDE / 2, avatar: HUB, mark: -1, label: input.hubLabel, busy: false, phase: 0 },
    { x: -310, y: 10, at: 0, radius: AGENT_RADIUS, ...first, busy: false, phase: 0 },
    { x: 255, y: -165, at: 1.62, radius: AGENT_RADIUS, ...second, busy: false, phase: 0 },
    { x: 255, y: 185, at: 3.12, radius: AGENT_RADIUS, ...third, busy: false, phase: 0 },
  ];
  const edges: NetworkEdge[] = [
    makeEdge(nodes, 1, 0, 0.18),
    makeEdge(nodes, 0, 2, 1.62 - EDGE_DRAW),
    makeEdge(nodes, 0, 3, 3.12 - EDGE_DRAW),
  ];
  const pulses: NetworkPulse[] = [
    { edge: 0, reverse: false, at: 0.95, duration: 0.62, sender: 1 },
    { edge: 1, reverse: false, at: 1.6, duration: 0.5, sender: 1 },
    { edge: 1, reverse: true, at: 2.75, duration: 0.5, sender: 2 },
    { edge: 2, reverse: false, at: 3.1, duration: 0.5, sender: 2 },
    { edge: 2, reverse: true, at: 4.3, duration: 0.5, sender: 3 },
    { edge: 0, reverse: true, at: 4.8, duration: 0.62, sender: 3 },
  ];
  const [firstText, secondText, thirdText] = input.messages;
  const messages: NetworkMessage[] = [
    { node: 1, text: firstText, at: 0.62, until: 5.25 },
    { node: 2, text: secondText, at: 2.5, until: 5.25 },
    { node: 3, text: thirdText, at: 4.0, until: 5.45 },
  ];

  // The grown network: each node branches outward from its parent. A place is
  // free when it keeps away from every node and its edge crosses none.
  type Place = { x: number; y: number; parent: number };
  const grown: Place[] = [];
  const parentEdges: [number, number][] = edges.map((edge) => [edge.from, edge.to]);
  const isFree = (x: number, y: number, parent: number) => {
    if ((x / WORLD_RX) ** 2 + (y / WORLD_RY) ** 2 > 1) return false;
    const origin = nodes[parent];
    if (!origin) return false;
    for (const [index, node] of nodes.entries()) {
      if (Math.hypot(node.x - x, node.y - y) < nodeReach(node) + GROWN_RADIUS + 46) return false;
      if (index !== parent && segmentDistance(node.x, node.y, origin.x, origin.y, x, y) < nodeReach(node) + 22) {
        return false;
      }
    }
    for (const [from, to] of parentEdges) {
      const a = nodes[from];
      const b = nodes[to];
      if (a && b && segmentDistance(x, y, a.x, a.y, b.x, b.y) < GROWN_RADIUS + 18) return false;
    }
    return true;
  };

  const queue: number[] = [0, 1, 2, 3];
  const childCount = (parent: number) => (parent === 0 ? 7 : 1 + Math.floor(next() * 3));
  while (grown.length < MAX_GROWN) {
    let parent = queue.shift();
    // When the branches stop, start a new one from a random node.
    if (parent === undefined) parent = Math.floor(next() * nodes.length);
    const origin = nodes[parent];
    if (!origin) break;
    const outward = parent === 0 ? next() * Math.PI * 2 : Math.atan2(origin.y, origin.x);
    let placed = 0;
    const wanted = childCount(parent);
    for (let attempt = 0; attempt < 12 && placed < wanted; attempt += 1) {
      const angle = parent === 0 ? outward + (attempt / 12) * Math.PI * 2 : outward + (next() - 0.5) * 2.3;
      const distance = 128 + next() * 60;
      const x = origin.x + Math.cos(angle) * distance;
      const y = origin.y + Math.sin(angle) * distance;
      if (!isFree(x, y, parent)) continue;
      const index = nodes.length;
      nodes.push({
        x,
        y,
        at: 0,
        radius: GROWN_RADIUS,
        avatar: Math.floor(next() * input.avatarCount),
        mark: Math.floor(next() * input.markCount),
        busy: next() < 0.16,
        phase: next() * Math.PI * 2,
      });
      grown.push({ x, y, parent });
      parentEdges.push([parent, index]);
      queue.push(index);
      placed += 1;
    }
    if (queue.length === 0 && grown.length > 0 && next() < 0.02) break;
  }

  // The network grows slowly first and then fast: the count rises with the
  // square of the time. A child never appears before its parent.
  const firstGrown = 4;
  for (const [order, place] of grown.entries()) {
    const node = nodes[firstGrown + order];
    const parent = nodes[place.parent];
    if (!node || !parent) continue;
    const scheduled = GROW_START + GROW_DURATION * ((order + 1) / grown.length) ** (1 / 2.3);
    node.at = Math.max(scheduled, parent.at + NODE_POP * 0.6 + EDGE_DRAW);
    edges.push(makeEdge(nodes, place.parent, firstGrown + order, node.at - EDGE_DRAW));
  }

  // Some neighbours are linked too, so it reads as a network and not a tree.
  const linked = new Set(parentEdges.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)));
  for (let index = firstGrown; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node || next() > 0.4) continue;
    let nearest = -1;
    let nearestDistance = 190;
    for (const [other, candidate] of nodes.entries()) {
      if (other === index || linked.has(other < index ? `${other}:${index}` : `${index}:${other}`)) continue;
      const distance = Math.hypot(candidate.x - node.x, candidate.y - node.y);
      if (distance >= nearestDistance) continue;
      const blocked = nodes.some(
        (third, thirdIndex) =>
          thirdIndex !== index &&
          thirdIndex !== other &&
          segmentDistance(third.x, third.y, node.x, node.y, candidate.x, candidate.y) < nodeReach(third) + 14,
      );
      if (!blocked) {
        nearest = other;
        nearestDistance = distance;
      }
    }
    const partner = nodes[nearest];
    if (!partner) continue;
    linked.add(nearest < index ? `${nearest}:${index}` : `${index}:${nearest}`);
    edges.push(makeEdge(nodes, index, nearest, Math.max(node.at, partner.at) + 0.12));
  }
  // The story edges start before the growth, so they keep indices 0 to 2, which the pulses use.
  edges.sort((a, b) => a.at - b.at);
  return {
    nodes,
    edges,
    messages,
    pulses,
    end: Math.max(ZOOM_START + ZOOM_DURATION, (edges.at(-1)?.at ?? 0) + EDGE_DRAW),
    salt: Math.floor(next() * 1_000_000) * 3,
  };
}

interface Camera {
  scale: number;
  /** The world point at the centre of the frame. */
  x: number;
  y: number;
  /** The scale at the start, which the labels compare against. */
  start: number;
}

function camera(view: NetworkView, t: number): Camera {
  const storyWidth = view.narrow ? NARROW_STORY_WIDTH : STORY_WIDTH;
  const start = Math.min(1, view.width / storyWidth, (view.height - view.top) / STORY_HEIGHT);
  // The camera moves back until the network fills the frame, and always by a clear step:
  // a tall, narrow frame fills at nearly the first scale.
  const fill = Math.max(view.width / (2 * WORLD_RX * 0.92), view.height / (2 * WORLD_RY * 0.92));
  const end = Math.min(start * 0.62, fill);
  const progress = easeInOutCubic(clamp01((t - ZOOM_START) / ZOOM_DURATION));
  return {
    scale: start + (end - start) * progress,
    x: STORY_CENTRE.x * (1 - progress),
    y: STORY_CENTRE.y * (1 - progress),
    start,
  };
}

function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Wraps `text` into the fewest lines, then narrows them so the last line is not one short word. */
function balancedLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines = wrapText(context, text, width);
  let low = width / 2;
  let high = width;
  while (high - low > 4) {
    const middle = (low + high) / 2;
    if (wrapText(context, text, middle).length > lines.length) low = middle;
    else high = middle;
  }
  return wrapText(context, text, high);
}

/** Draws the frame at second `t`. `ambient` adds the background pulses after the story. */
export function drawAgentNetwork(
  context: CanvasRenderingContext2D,
  network: AgentNetwork,
  assets: NetworkAssets,
  view: NetworkView,
  t: number,
  ambient: boolean,
): void {
  const { width, height } = view;
  const cam = camera(view, t);
  const toX = (x: number) => (x - cam.x) * cam.scale + width / 2;
  const toY = (y: number) => (y - cam.y) * cam.scale + view.top + (height - view.top) / 2;
  const margin = 40;
  const onScreen = (x: number, y: number, reach: number) =>
    x > -reach - margin && x < width + reach + margin && y > -reach - margin && y < height + reach + margin;
  const colorOf = (node: NetworkNode | undefined) =>
    !node || node.avatar === HUB
      ? assets.colors.hubPulse
      : (assets.avatarColors[node.avatar] ?? assets.colors.hubPulse);

  context.clearRect(0, 0, width, height);
  const dotRadius = Math.max(0.9, DOT_RADIUS * cam.scale);

  // Edges at rest: one path for every visible dot.
  context.fillStyle = assets.colors.dot;
  context.beginPath();
  for (const edge of network.edges) {
    if (edge.at > t) break;
    const count = edge.dots.length / 2;
    const shown = Math.ceil(count * easeOutCubic(clamp01((t - edge.at) / EDGE_DRAW)));
    for (let index = 0; index < shown; index += 1) {
      const x = toX(edge.dots[index * 2] ?? 0);
      const y = toY(edge.dots[index * 2 + 1] ?? 0);
      if (!onScreen(x, y, 0)) continue;
      context.moveTo(x + dotRadius, y);
      context.arc(x, y, dotRadius, 0, Math.PI * 2);
    }
  }
  context.fill();

  // Pulses: the dots light in the sender's colour, with a white head.
  const drawPulse = (pulse: NetworkPulse) => {
    const edge = network.edges[pulse.edge];
    if (!edge) return;
    const progress = (t - pulse.at) / pulse.duration;
    if (progress < 0 || progress > 1 + PULSE_TRAIL / (edge.dots.length / 2)) return;
    const count = edge.dots.length / 2;
    const head = progress * (count - 1);
    const color = colorOf(network.nodes[pulse.sender]);
    for (let step = 0; step <= PULSE_TRAIL; step += 1) {
      const position = Math.floor(head) - step;
      if (position < 0 || position >= count) continue;
      const index = pulse.reverse ? count - 1 - position : position;
      const x = toX(edge.dots[index * 2] ?? 0);
      const y = toY(edge.dots[index * 2 + 1] ?? 0);
      const strength = 1 - (head - position) / (PULSE_TRAIL + 1);
      context.globalAlpha = clamp01(strength);
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, dotRadius * (1 + 0.55 * strength), 0, Math.PI * 2);
      context.fill();
      if (step === 0) {
        context.fillStyle = assets.colors.hubPulse;
        context.beginPath();
        context.arc(x, y, dotRadius * 0.7, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
  };
  for (const pulse of network.pulses) drawPulse(pulse);
  if (ambient && t > GROW_START) {
    const last = Math.floor((t - GROW_START) / AMBIENT_SLOT);
    const firstSlot = Math.max(0, Math.floor((t - GROW_START - AMBIENT_MAX_DURATION) / AMBIENT_SLOT));
    for (let slot = firstSlot; slot <= last; slot += 1) {
      const at = GROW_START + slot * AMBIENT_SLOT;
      let visible = 0;
      while (visible < network.edges.length && (network.edges[visible]?.at ?? Infinity) + EDGE_DRAW < at) visible += 1;
      if (visible < 4 || hash(network.salt + slot * 3) > Math.min(0.85, visible / 260)) continue;
      const edgeIndex = 3 + Math.floor(hash(network.salt + slot * 3 + 1) * (visible - 3));
      const edge = network.edges[edgeIndex];
      if (!edge) continue;
      const reverse = hash(network.salt + slot * 3 + 2) < 0.5;
      drawPulse({
        edge: edgeIndex,
        reverse,
        at,
        duration: Math.min(AMBIENT_MAX_DURATION * 0.75, edge.length / PULSE_SPEED),
        sender: reverse ? edge.to : edge.from,
      });
    }
  }

  // Nodes, with their badge and the typing pill.
  context.textAlign = "center";
  context.textBaseline = "top";
  const labelAlpha = clamp01((cam.scale / cam.start - 0.78) / 0.14);
  for (const node of network.nodes) {
    if (node.at > t) continue;
    const pop = clamp01((t - node.at) / NODE_POP);
    const x = toX(node.x);
    const y = toY(node.y);
    const radius = node.radius * cam.scale * easeOutBack(pop);
    if (radius <= 0 || !onScreen(x, y, radius * 2)) continue;
    context.globalAlpha = clamp01(pop * 2.5);

    if (node.avatar === HUB) {
      const side = radius * 2;
      const unit = side / APP_LOGO_SIZE;
      context.fillStyle = assets.colors.hub;
      context.beginPath();
      context.roundRect(x - radius, y - radius, side, side, APP_LOGO_CORNER * unit);
      context.fill();
      context.strokeStyle = assets.colors.hubEye;
      context.lineWidth = 9.5 * unit;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const points of [APP_LOGO_EYE_POINTS.left, APP_LOGO_EYE_POINTS.right]) {
        const values = points.split(" ").map(Number);
        context.beginPath();
        for (let index = 0; index < values.length; index += 2) {
          const px = x - radius + (values[index] ?? 0) * unit;
          const py = y - radius + (values[index + 1] ?? 0) * unit;
          if (index === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.stroke();
      }
    } else {
      const image = assets.avatars[node.avatar];
      if (image) {
        context.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
      } else {
        context.fillStyle = colorOf(node);
        context.beginPath();
        context.arc(x, y, radius * 0.8, 0, Math.PI * 2);
        context.fill();
      }
      const mark = assets.marks[node.mark];
      // A badge keeps a readable size when the camera moves back, so it grows against its avatar.
      const badge = Math.max(radius * 0.42, Math.min(BADGE_MIN_RADIUS, radius * 0.75));
      if (mark && radius >= 4) {
        const bx = x + radius * 0.74;
        const by = y - radius * 0.74;
        context.fillStyle = assets.colors.canvas;
        context.beginPath();
        context.arc(bx, by, badge + Math.max(1.5, badge * 0.18), 0, Math.PI * 2);
        context.fill();
        context.fillStyle = assets.colors.badge;
        context.beginPath();
        context.arc(bx, by, badge, 0, Math.PI * 2);
        context.fill();
        const size = badge * 1.3;
        context.drawImage(mark, bx - size / 2, by - size / 2, size, size);
      }
      if (node.busy && radius >= 7) {
        const typing = Math.sin(t * 0.9 + node.phase);
        if (typing > 0.25) {
          const pillHeight = Math.max(radius * 0.42, Math.min(BADGE_MIN_RADIUS * 1.2, radius * 0.8));
          const pillWidth = pillHeight * 2.3;
          const px = x - radius * 0.55 - pillWidth;
          const py = y - radius * 0.8 - pillHeight / 2;
          context.globalAlpha = clamp01(pop * 2.5) * clamp01((typing - 0.25) * 5);
          context.fillStyle = assets.colors.badge;
          context.beginPath();
          context.roundRect(px, py, pillWidth, pillHeight, pillHeight / 2);
          context.fill();
          context.fillStyle = assets.colors.bubbleText;
          for (let dot = 0; dot < 3; dot += 1) {
            const lift = Math.max(0, Math.sin(t * 7 - dot * 0.9 + node.phase)) * pillHeight * 0.12;
            context.beginPath();
            context.arc(
              px + pillWidth * (0.28 + dot * 0.22),
              py + pillHeight / 2 - lift,
              pillHeight * 0.12,
              0,
              Math.PI * 2,
            );
            context.fill();
          }
        }
      }
    }

    if (node.label && labelAlpha > 0) {
      context.globalAlpha = clamp01(pop * 2.5) * labelAlpha;
      context.fillStyle = assets.colors.label;
      context.font = `500 13px ${assets.font}`;
      context.fillText(node.label, x, y + radius + 9);
    }
    context.globalAlpha = 1;
  }

  // Message bubbles stay at reading size whatever the camera scale.
  context.textAlign = "left";
  context.font = `400 14px ${assets.font}`;
  const lineHeight = 20;
  for (const [order, message] of network.messages.entries()) {
    const following = network.messages[order + 1];
    const until = view.narrow && following ? following.at : message.until;
    const appear = clamp01((t - message.at) / 0.3);
    const leave = clamp01((t - until) / 0.25);
    const alpha = easeOutCubic(appear) * (1 - leave);
    const node = network.nodes[message.node];
    if (alpha <= 0 || !node) continue;
    const lines = balancedLines(context, message.text, Math.min(320, width - 32) - 28);
    const textWidth = Math.max(...lines.map((line) => context.measureText(line).width));
    const boxWidth = textWidth + 28;
    const boxHeight = lines.length * lineHeight + 18;
    const anchorX = toX(node.x);
    const left = Math.min(width - 16 - boxWidth, Math.max(16, anchorX - boxWidth / 2));
    // In a narrow frame a bubble over a lower agent covers the hub, so it goes under the agent's name.
    const below = view.narrow && node.y > 0;
    const reach = node.radius * cam.scale;
    const top =
      (below ? toY(node.y) + reach + 34 : toY(node.y) - reach - 12 - boxHeight) +
      (1 - easeOutCubic(appear)) * (below ? -8 : 8);
    context.globalAlpha = alpha;
    context.fillStyle = assets.colors.bubble;
    context.strokeStyle = assets.colors.bubbleBorder;
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(left, top, boxWidth, boxHeight, 12);
    context.fill();
    context.stroke();
    context.fillStyle = assets.colors.bubbleText;
    for (const [index, line] of lines.entries()) {
      context.fillText(line, left + 14, top + 10 + index * lineHeight);
    }
    context.globalAlpha = 1;
  }
}
