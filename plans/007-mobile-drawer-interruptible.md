# 007 — Let the server drawer be caught while it moves

- **Status**: TODO
- **Commit**: 86f9979ef (with uncommitted onboarding and sign-in hand-off work in the tree; see Boundaries)
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 1 file, about 30 changed lines

## Problem

The server drawer (`apps/mobile/src/features/servers/components/app-drawer-shell.tsx`) has three
seams. All three show when the user touches the drawer while it still moves.

**1. A pan that starts during motion jumps.** Both pans compute the progress from the translation
alone. They ignore where the drawer is when the finger takes it:

```tsx
// app-drawer-shell.tsx:111-113 — opening pan, current
.onUpdate((event) => {
  drawerProgress.set(Math.min(1, Math.max(0, event.translationX / drawerWidth)));
})
```

```tsx
// app-drawer-shell.tsx:138-140 — closing pan, current
.onUpdate((event) => {
  drawerProgress.set(Math.min(1, Math.max(0, 1 + event.translationX / drawerWidth)));
})
```

Example: the user closes the drawer, and at progress 0.5 drags left again to push it away. The
closing pan activates after 8 pt (`activeOffsetX(-8)`, line 135), and the first update sets progress
to `1 - 8 / drawerWidth`, about 0.97. The drawer jumps back open under the finger. The opening pan
has the same jump in the other direction.

**2. After a fling open, the scrim takes no taps until the spring ends.** The pan commits
`drawerOpen` only in the spring callback:

```tsx
// app-drawer-shell.tsx:114-127 — opening pan end, current
.onEnd((event) => {
  const projected = drawerProgress.get() + event.velocityX / drawerWidth / 6;
  const shouldOpen = projected > 0.45;
  if (shouldOpen) scheduleOnRN(triggerDrawerHaptic);
  drawerProgress.set(
    withSpring(
      shouldOpen ? 1 : 0,
      { ...DRAWER_SPRING, velocity: event.velocityX / drawerWidth },
      (finished) => {
        if (finished) scheduleOnRN(commitDrawerState, shouldOpen);
      },
    ),
  );
}),
```

```tsx
// app-drawer-shell.tsx:250 — scrim, current
<View className="absolute inset-0" pointerEvents={drawerOpen ? "auto" : "none"}>
```

While the spring settles (300 ms perceptual, up to 450 ms real), a tap on the dimmed surface goes to
the screen under the scrim, and the closing pan is off (`.enabled(drawerOpen)`, line 134). The
button path (`openDrawer`, lines 71-79) already sets `drawerOpen` before its spring. Only the pan
path is late.

**3. Navigation from the drawer waits for a fixed timer:**

```tsx
// app-drawer-shell.tsx:178-184 — current
const navigateAfterClosing = useCallback(
  (href: Href) => {
    closeDrawer();
    setTimeout(() => router.push(href), 300);
  },
  [closeDrawer],
);
```

The spring is not tied to 300 ms. Reanimated 4.5 runs a spring for 1.5 × its perceptual `duration`
(`node_modules/react-native-reanimated/src/animation/spring/springConfigs.ts:60-62`), and
`overshootClamping` can end it earlier. So the page push can start while the surface still slides,
and two motions overlap.

## Target

- **Start capture:** each pan stores the progress at activation and adds the translation to it:
  `progress = clamp(dragStart + translationX / drawerWidth, 0, 1)`. At rest this is the same as
  today: `dragStart` is 0 for the opening pan and 1 for the closing pan. On activation, stop the
  running spring with `cancelAnimation(drawerProgress)`.
- **Open-bound state:** when the opening pan releases toward open, commit `drawerOpen = true` at
  once, before the spring, as `openDrawer` does. The scrim takes taps, and the closing pan works,
  while the drawer settles. The close direction keeps its commit at the end of the spring: the
  drawer content leaves edit mode when `open` turns false (`server-drawer-content.tsx:192-196`), and
  that change must not show while the drawer slides out.
- **Spring:** unchanged. `DRAWER_SPRING = { dampingRatio: 0.8, duration: 300, overshootClamping: true, reduceMotion: ReduceMotion.System }`
  (lines 33-38), with the release velocity `event.velocityX / drawerWidth`.
- **Navigation:** push the page when the close spring reports `finished`. A deadline of 600 ms
  (1.5 × the 300 ms perceptual duration, plus 150 ms) pushes it if the close is interrupted or its
  callback is lost. The page is pushed exactly once.

```tsx
// target: pans (worklets)
const dragStart = useSharedValue(0);
// opening pan
.onStart(() => {
  cancelAnimation(drawerProgress);
  dragStart.set(drawerProgress.get());
})
.onUpdate((event) => {
  drawerProgress.set(Math.min(1, Math.max(0, dragStart.get() + event.translationX / drawerWidth)));
})
.onEnd((event) => {
  const projected = drawerProgress.get() + event.velocityX / drawerWidth / 6;
  const shouldOpen = projected > 0.45;
  if (shouldOpen) {
    scheduleOnRN(triggerDrawerHaptic);
    // The drawer is open as soon as it heads there: the scrim takes taps while it settles.
    scheduleOnRN(commitDrawerState, true);
  }
  drawerProgress.set(/* the existing withSpring call, unchanged */);
})
```

```tsx
// target: close with a completion callback, and navigation on completion
// A page opened from the drawer waits for the close. The deadline covers an interrupted close.
const NAVIGATE_DEADLINE_MS = 600;

const closeDrawerThen = useCallback(
  (onClosed?: () => void) => {
    triggerDrawerHaptic();
    drawerProgress.set(
      withSpring(0, DRAWER_SPRING, (finished) => {
        if (!finished) return;
        scheduleOnRN(commitDrawerState, false);
        if (onClosed) scheduleOnRN(onClosed);
      }),
    );
  },
  [commitDrawerState, drawerProgress],
);
const closeDrawer = useCallback(() => closeDrawerThen(), [closeDrawerThen]);

const navigateAfterClosing = useCallback(
  (href: Href) => {
    let pending = true;
    const navigate = () => {
      if (!pending) return;
      pending = false;
      router.push(href);
    };
    setTimeout(navigate, NAVIGATE_DEADLINE_MS);
    closeDrawerThen(navigate);
  },
  [closeDrawerThen],
);
```

`closeDrawer` must stay a function with no parameters. It is passed as `onPress={closeDrawer}`
(line 259), and `Pressable` calls it with a press event. That event must not reach `onClosed`.

## Repo conventions to follow

- Start capture in a pan: `apps/mobile/src/features/chat/components/image-viewer.tsx:277-291`
  (`cancelAnimation(tx); startX.set(tx.get());` in `.onStart`, then `startX.get() + event.translationX`
  in `.onUpdate`, line 302).
- Completion plus deadline: `apps/mobile/src/features/auth/components/scan-qr-sheet.tsx:101-124`
  (`beforeConnect`: the timing callback and a 1000 ms `setTimeout` both release one pending action).
- JS callbacks from a spring callback go through `scheduleOnRN`, as at lines 76, 85, 123 and 150.
- The opening gesture must stay the same object (comment at lines 96-97). Add only stable values
  (shared values, `useCallback` results) to its `useMemo` dependencies.

## Steps

1. Import `cancelAnimation` from `react-native-reanimated` (lines 7-14).
2. Add `const NAVIGATE_DEADLINE_MS = 600;` after `DRAWER_SPRING` (line 38), with the one-line comment
   from Target.
3. Replace `closeDrawer` (lines 81-88) with `closeDrawerThen` and `closeDrawer` from Target.
4. Add `const dragStart = useSharedValue(0);` next to `openingEnabled` (line 98).
5. Opening pan (lines 102-129): add `.onStart` before `.onUpdate`, change `.onUpdate`, and add the
   immediate `scheduleOnRN(commitDrawerState, true)` in `.onEnd`, as in Target. Keep the spring call
   and its callback as they are. Add `dragStart` to the `useMemo` dependencies.
6. Closing pan (lines 131-156): add the same `.onStart`, and change `.onUpdate` to
   `drawerProgress.set(Math.min(1, Math.max(0, dragStart.get() + event.translationX / drawerWidth)));`.
   Keep `.onEnd`. Add `dragStart` to the `useMemo` dependencies.
7. Replace `navigateAfterClosing` (lines 178-184) with the Target version. Change its dependency
   list to `[closeDrawerThen]`.
8. Release note. Add this item under `### Fixed` in `apps/mobile/changelog.d/<branch>.md`
   (`<branch>` is `git branch --show-current` with `-` for `/`):
   `- You can catch the server list while it slides, and tap outside it as soon as it opens. Before, it jumped under your finger, and a tap during the slide went to the screen behind it.`
   If that file has uncommitted changes that are not yours, do not edit it. Put the item text in
   your report.

## Boundaries

- Do NOT change `DRAWER_SPRING`, the projection factor (`/ 6`), the thresholds 0.45 and 0.55, the
  gesture offsets (`activeOffsetX`, `failOffsetX`, `failOffsetY`), the haptics, or the animated
  styles (lines 158-176).
- Do NOT add rubber-banding past 0 or 1. The styles at lines 158-176 extrapolate, so a value past 1
  would move the surface and the drawer too far. That is a separate change.
- Do NOT change the close commit to happen at the start of the close. It would reset the drawer's
  edit mode while the drawer is still visible.
- Do NOT touch `server-drawer-content.tsx`, `agent-pin-swipe-row.tsx`, `use-agent-pin-swipe.ts`, or
  any file that uses `openingGesture`.
- Do NOT touch files that have uncommitted changes from the onboarding and sign-in hand-off work:
  everything under `apps/mobile/src/features/onboarding/` (`agent-step.tsx` uses `openingGesture`),
  `loader-flight.tsx`, `bloub-loader.tsx`, `app-loading-overlay.tsx`, `sign-in-screen.tsx`,
  `connected-screen.tsx` (it calls `openDrawer`), `_layout.tsx`, and the other files in
  `git status --short`.
- Do NOT add dependencies. Do NOT add `biome-ignore`.
- If a step does not match the code (drift since the commit stamp), STOP and report.

## Verification

- **Mechanical**, one command at a time:
  - `bunx biome check --write --max-diagnostics=none apps/mobile/src/features/servers/components/app-drawer-shell.tsx`: no errors.
  - `bun run test:related -- apps/mobile/src/features/servers/components/app-drawer-shell.tsx`: all pass.
  - Do not run the mobile typecheck by hand. The pre-commit hook runs it when the work is committed.
    Until then, say in your report that types are not verified.
- **Feel check** (iPhone and Android device; needs the developer's permission for a device build,
  see `apps/mobile/AGENTS.md`; if you do not have it, report the feel check as not done):
  - Tap the drawer button, then at once drag the moving surface back to the left. The surface stops
    under the finger and follows it. It does not jump open or closed.
  - Fling the drawer open and, while it settles, tap the dimmed surface. The drawer closes. Before,
    the tap went to the agent list.
  - Fling the drawer open and at once drag it closed. The drag takes it from where it is.
  - Close the drawer with a tap on the scrim and drag right before it is closed. Note the result in
    your report: the closing pan accepts only a left drag first (`failOffsetX(12)`), so a right drag
    does not catch it. That is expected and out of scope.
  - Tap Settings, or the options of a server, in the drawer. The page push starts when the surface
    lands, not before. Drag the drawer during that close: the page still opens, at the latest 600 ms
    after the tap, and only once.
  - Turn on system Reduce Motion: the drawer jumps open and closed, and Settings still opens at once.
  - Record the screen and step frame by frame during a caught drag: no frame shows the surface away
    from the finger by more than the 8–12 pt activation distance.
- **Done when**: a pan that starts during motion continues from the current progress, the scrim
  takes taps from the moment a fling releases toward open, and `router.push` from the drawer runs on
  the close spring's completion or at the 600 ms deadline, once.
