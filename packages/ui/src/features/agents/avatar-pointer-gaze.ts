// Eyes that look at the pointer, for the few avatars that ask for it (`followPointer`).
//
// One pointer listener serves every following avatar. A pointer move asks for one animation frame,
// and that frame writes two custom properties on each follower; the eyes group reads them as a
// `translate` with a CSS transition. Nothing runs while the pointer is still.

// The furthest the eyes move, in drawing units (the body radius is about 37).
const GAZE_X = 3.2;
const GAZE_Y = 2.6;
// How far the pointer can go from an avatar before the eyes stop turning. A distance in pixels, not
// a part of the window, so that agents next to each other look at the pointer from their own place.
const REACH = 320;

const followers = new Set<HTMLElement>();
let pointer: { x: number; y: number } | null = null;
let frame = 0;
let reducedMotion: MediaQueryList | undefined;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function update(): void {
  frame = 0;
  const still = reducedMotion?.matches === true;
  for (const element of followers) {
    const box = pointer && !still ? element.getBoundingClientRect() : undefined;
    if (!pointer || !box || box.width === 0) {
      element.style.removeProperty("--agent-avatar-gaze-x");
      element.style.removeProperty("--agent-avatar-gaze-y");
      continue;
    }
    const x = clampUnit((pointer.x - (box.left + box.width / 2)) / REACH);
    const y = clampUnit((pointer.y - (box.top + box.height / 2)) / REACH);
    element.style.setProperty("--agent-avatar-gaze-x", `${(x * GAZE_X).toFixed(2)}px`);
    element.style.setProperty("--agent-avatar-gaze-y", `${(y * GAZE_Y).toFixed(2)}px`);
  }
}

function schedule(): void {
  if (frame === 0 && !document.hidden) frame = requestAnimationFrame(update);
}

function trackPointer(event: PointerEvent): void {
  if (event.pointerType === "touch") return;
  pointer = { x: event.clientX, y: event.clientY };
  schedule();
}

function forgetPointer(event: PointerEvent): void {
  // Leaving the window is the only `pointerout` without a next target.
  if (event.relatedTarget !== null) return;
  pointer = null;
  schedule();
}

/** Makes the eyes of one avatar follow the pointer. Returns the release. */
export function followPointer(element: HTMLElement): () => void {
  if (followers.size === 0) {
    reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    window.addEventListener("pointermove", trackPointer, { passive: true });
    document.addEventListener("pointerout", forgetPointer, { passive: true });
  }
  followers.add(element);
  schedule();
  return () => {
    followers.delete(element);
    element.style.removeProperty("--agent-avatar-gaze-x");
    element.style.removeProperty("--agent-avatar-gaze-y");
    if (followers.size > 0) return;
    window.removeEventListener("pointermove", trackPointer);
    document.removeEventListener("pointerout", forgetPointer);
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    pointer = null;
    reducedMotion = undefined;
  };
}
