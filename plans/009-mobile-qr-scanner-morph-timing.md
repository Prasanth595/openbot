# 009 — Close the QR scanner faster than it opens, and keep its clip morph

- **Status**: TODO
- **Commit**: 86f9979ef (with uncommitted onboarding and sign-in hand-off work in the tree; see Boundaries)
- **Severity**: MEDIUM
- **Category**: Performance, Easing & duration, Interruptibility (asymmetric timing)
- **Estimated scope**: 1 file, about 15 changed lines

## Problem

The sign-in QR scanner grows out of the "Scan QR code" button. The morph animates layout props of
the clip view over the live camera:

```tsx
// apps/mobile/src/features/auth/components/scan-qr-sheet.tsx:164-182 — current
// Animate only this absolute clip. Its children keep their final dimensions;
// the native camera never changes size or stretches with the button surface.
const departureStyle = useAnimatedStyle(() => ({
  opacity: (reducedMotion ? progress.get() : 1) * (1 - departure.get()),
  transform: [{ translateY: reducedMotion ? 0 : -24 * departure.get() }],
}));
const coverStyle = useAnimatedStyle(() => ({ opacity: departure.get() }));
const panelStyle = useAnimatedStyle(() => {
  const p = reducedMotion ? 1 : progress.get();
  return {
    left: origin.x + (x - origin.x) * p,
    top: origin.y + (y - origin.y) * p,
    width: origin.width + (width - origin.width) * p,
    height: origin.height + (height - origin.height) * p,
    borderRadius: radius * (1 + p),
    backgroundColor: interpolateColor(p, [0, 1], [brand, surface]),
    opacity: reducedMotion ? progress.get() : 1,
  };
});
```

It closes with the same duration and curve as it opens:

```tsx
// scan-qr-sheet.tsx:30-31 — current
// Shared brand curve for a continuous shape change in both directions.
const EASE_MORPH = Easing.bezier(0.77, 0, 0.175, 1);
```

```tsx
// scan-qr-sheet.tsx:75-83 — open, current
progress.set(
  withTiming(
    1,
    { duration: reducedMotion ? 160 : 400, easing: EASE_MORPH, reduceMotion: ReduceMotion.Never },
    (finished) => {
      if (finished) scheduleOnRN(finishOpen);
    },
  ),
);
```

```tsx
// scan-qr-sheet.tsx:131-139 — close, current
progress.set(
  withTiming(
    0,
    { duration: reducedMotion ? 160 : 400, easing: EASE_MORPH, reduceMotion: ReduceMotion.Never },
    (finished) => {
      if (finished) scheduleOnRN(finishClose);
    },
  ),
);
```

Two issues:

1. **Symmetric timing.** The close is the system's answer to "go away". At 400 ms with a strong
   ease-in-out, the first 100 ms barely move: the panel seems to ignore the tap. An exit must be
   faster than the entrance and start fast.
2. **Layout props during motion.** `left`, `top`, `width` and `height` change on each frame. With
   Reanimated on the new architecture, a layout prop goes through a shadow tree commit and a layout
   pass on each frame; `transform` and `opacity` do not.

## Decision on issue 2: keep the layout props

A transform-only morph cannot keep the corner radius here. Evidence:

- The source is the sign-in button: full width and 52 pt high (`SIGN_IN_CONTROL_HEIGHT`,
  `apps/mobile/src/features/auth/components/sign-in-colors.ts:32`). The panel is up to 400 × 560 pt
  (`scan-qr-sheet.tsx:60-61`). A full-size frame scaled down to the button needs `scaleY` of about
  0.09 and `scaleX` of about 0.9.
- Under that scale, the 12 pt start radius (`--openbot-radius-lg`, `packages/brand/src/tokens.css:295`)
  turns into an ellipse about 11 pt wide and 1 pt high. To cancel
  it, the frame needs a different horizontal and vertical radius for each corner. React Native 0.86
  takes one value per corner (`borderTopLeftRadius?: AnimatableNumericValue | string`,
  `node_modules/react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts:493`), and it has no
  `clip-path`. A counter-scaled inner view fixes the content, but not the clip's corners, and the
  panel's brand fill would show square corners around the button copy at the start.
- The repo made the same choice for the chat attachment card, with a comment:
  `apps/mobile/src/features/chat/components/chat-attachment-panel.tsx:294-298` ("The card's own width
  and height carry the morph: a scale would smear its corner radius and its text. Both contents keep
  their own size while it resizes around them, so nothing inside the card re-lays-out on a frame…").
- `apps/mobile/CAMERA-PERFORMANCE.md:43-44` says: "The QR panel still changes its clip bounds during
  the morph. Profile that path before replacing it with a transform or a canvas." No device profile
  exists yet.
- The cost is already small: the clip is absolutely positioned, and its children have fixed sizes
  (comment at lines 164-165), so the layout pass touches one view. The morph is rare (sign-in only).
- Moving only `left`/`top` to `translateX`/`translateY` gives no real gain while `width`/`height`
  still commit each frame, and `departureStyle` already owns the `transform` of the same view
  (line 209: `style={[panelStyle, departureStyle]}`). A second transform would replace the first.

So this plan keeps `panelStyle` as it is, records the reason in a comment, and fixes the timing. If
the device profile in Verification misses the targets of `CAMERA-PERFORMANCE.md`, report the numbers;
a canvas clip is then a separate plan.

## Target

| Direction | Motion | Duration | Curve |
| --- | --- | --- | --- |
| Open | full | 400 ms (unchanged) | `Easing.bezier(0.32, 0.72, 0, 1)` (drawer curve: starts fast, settles gently) |
| Close | full | 240 ms (`--openbot-duration-overlay`, `packages/brand/src/tokens.css:345`) | `Easing.bezier(0.23, 1, 0.32, 1)` (strong ease-out) |
| Open | reduced (fade only) | 160 ms (unchanged) | `Easing.bezier(0.32, 0.72, 0, 1)` |
| Close | reduced (fade only) | 160 ms (unchanged) | `Easing.bezier(0.23, 1, 0.32, 1)` |

Why the open curve changes: the open already waits for `onCameraReady` before it starts
(`CAMERA-PERFORMANCE.md`, `onPreviewReady={beginOpening}` at line 221). The ease-in-out start
(`0.77, 0, …`) adds about 100 ms in which the panel barely moves. The panel enters the screen, and an
entrance takes an ease-out curve.

```tsx
// scan-qr-sheet.tsx — target constants (replace lines 30-31)
// The scanner grows out of the button like a sheet, and goes back faster than it came.
const EASE_OPEN = Easing.bezier(0.32, 0.72, 0, 1);
const EASE_CLOSE = Easing.bezier(0.23, 1, 0.32, 1);
const OPEN_MS = 400;
const CLOSE_MS = 240;
const REDUCED_MS = 160;
```

```tsx
// target open timing
{ duration: reducedMotion ? REDUCED_MS : OPEN_MS, easing: EASE_OPEN, reduceMotion: ReduceMotion.Never }
// target close timing
{ duration: reducedMotion ? REDUCED_MS : CLOSE_MS, easing: EASE_CLOSE, reduceMotion: ReduceMotion.Never }
```

```tsx
// target comment above panelStyle (add after line 165)
// The clip keeps layout props: a scale from the 52 pt button to the panel would make its corners
// elliptical, and React Native has one radius per corner. See CAMERA-PERFORMANCE.md before changing it.
```

## Repo conventions to follow

- The strong ease-out is already in this file for the departure: `scan-qr-sheet.tsx:115`.
- Durations and curves come from the brand tokens: `packages/brand/src/tokens.css:340-354`.
- Named timing constants at the top of a motion file: `apps/mobile/src/features/onboarding/components/onboarding-motion.ts:25-29`
  (`STEP_ENTER_MS = 300`, `STEP_EXIT_MS = 160`: the exit is faster than the entrance). That file is
  uncommitted onboarding work: read it, do not edit it.
- Keep `reduceMotion: ReduceMotion.Never`. The component chooses the reduced path itself with
  `useReducedMotion()` from `@/shared/lib/motion`.

## Steps

1. Replace `EASE_MORPH` and its comment (lines 30-31) with the five constants from Target.
2. `beginOpening` (lines 75-83): use the target open timing.
3. `close` (lines 131-139): use the target close timing.
4. Add the comment from Target above `panelStyle` (after the comment at lines 164-165). Do not change
   `panelStyle`, `previewStyle`, `buttonStyle`, `blurStyle`, `backdropStyle` or `departureStyle`.
5. Release note. Add this item under `### Changed` in `apps/mobile/changelog.d/<branch>.md`
   (`<branch>` is `git branch --show-current` with `-` for `/`):
   `- The QR code scanner on the sign-in screen opens with a quicker start and closes faster.`
   If that file has uncommitted changes that are not yours, do not edit it. Put the item text in
   your report.

## Boundaries

- Do NOT replace the clip morph with transforms, a mask or a canvas in this plan (see the decision).
- Do NOT change the departure (lines 101-124), its 280 ms, or its 1000 ms deadline.
- Do NOT change the preview, button and blur thresholds (`0.2`, `0.65`, `0.3`). With the new curves
  they arrive earlier in time, which is the goal.
- Do NOT remove the blur veil. Note for the developer: on Android the veil blurs the live camera
  through `BlurTargetView` for the whole morph. Profile it with the clip in the same session.
- Do NOT touch `scan-qr-sheet.test.tsx` or `sign-in-screen.tsx`. Both have uncommitted changes from
  the onboarding and sign-in hand-off work. The test mocks `Easing.bezier`, so the new constants load.
  Also do not touch the other hand-off files: everything under `apps/mobile/src/features/onboarding/`,
  `loader-flight.tsx`, `bloub-loader.tsx`, `app-loading-overlay.tsx`, `connected-screen.tsx`,
  `_layout.tsx`, and the rest of `git status --short`.
- Plan 008 also edits `scan-qr-sheet.tsx` (`scan`, lines 150-162). Run the plans one after the
  other, not at the same time.
- Do NOT add dependencies. Do NOT add `biome-ignore`.
- If a step does not match the code (drift since the commit stamp), STOP and report.

## Verification

- **Mechanical**, one command at a time:
  - `bunx biome check --write --max-diagnostics=none apps/mobile/src/features/auth/components/scan-qr-sheet.tsx`: no errors.
  - `bun run test:related -- apps/mobile/src/features/auth/components/scan-qr-sheet.tsx`: all pass.
  - Do not run the mobile typecheck by hand. The pre-commit hook runs it when the work is committed.
    Until then, say in your report that types are not verified.
- **Feel check** (a real Android phone first, then an iPhone; release build; needs the developer's
  permission for a device build, see `apps/mobile/AGENTS.md`; if you do not have it, report the feel
  check as not done):
  - Sign out. Tap "Scan QR code". When the camera is ready, the panel starts to grow at once and
    slows into place. No frame shows the panel stuck at the button size after it starts.
  - Tap outside the panel, or press Android Back. The panel starts to shrink in the same frame and
    lands on the button in about 240 ms. The button copy fades back in during the tail.
  - Open, then close in the middle of the opening. The close starts from where the panel is. No jump.
  - Record the screen and step frame by frame: the corners stay round at all sizes, and the camera
    image is never stretched.
  - Turn on system Reduce Motion: the panel only fades, 160 ms each way.
  - Profile on the slowest supported Android phone, as `CAMERA-PERFORMANCE.md` says: 20 open and
    close cycles, frame times during the morph. Targets: at least 95% of frames within one display
    interval, no frame above 50 ms. Report the numbers.
- **Done when**: the close takes 240 ms with the strong ease-out, the open takes 400 ms with the drawer
  curve, `panelStyle` is unchanged and carries the comment, and the device numbers are reported or
  marked as not measured.
