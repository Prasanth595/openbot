# 006 — Draw the avatar saturate filter only while the avatar is not full color

- **Status**: TODO
- **Commit**: 86f9979ef (with uncommitted onboarding and sign-in hand-off work in the tree; see Boundaries)
- **Severity**: MEDIUM
- **Category**: Performance, Purpose & frequency
- **Estimated scope**: 2 files, about 15 lines

## Problem

`AnimatedAvatarPreview` always wraps the avatar in a saturate filter, also when the agent is online
and the saturation is 1 (no visible effect):

```tsx
// apps/mobile/src/features/agents/components/bloub-avatar.tsx:97-100 — current
const appearance = useConnectionAppearance(disconnected);
const colorProps = useAnimatedProps(() => ({ values: [appearance.get().saturation] }));
const appearanceStyle = useAnimatedStyle(() => ({ opacity: appearance.get().opacity }));
const frame = useBloubActivityFrame(seed, mood, animateIdle && !disconnected);
```

```tsx
// apps/mobile/src/features/agents/components/bloub-avatar.tsx:105-128 — current
// The opacity stays on the native view: react-native-svg on Android crashes with
// "Underflow in restore" when a filtered <G> has an opacity other than 1.
return (
  <Animated.View pointerEvents="none" style={[{ width: size, height: size }, appearanceStyle]}>
    <Svg /* … */>
      <Defs>
        <Filter id={`${maskId}-offline`}>
          <AnimatedColorMatrix type="saturate" animatedProps={colorProps} />
        </Filter>
        <Mask id={maskId} /* … */>{/* body and eyes */}</Mask>
      </Defs>
      {/* Mobile-only feedback: keep the synced avatar profile and color untouched. */}
      <G filter={`url(#${maskId}-offline)`}>
```

The idle loop of an online avatar redraws at 30 fps (`IDLE_FPS`,
`apps/mobile/src/features/agents/model/bloub-activity.ts:27`); a busy face redraws at 60 fps. On
Android, react-native-svg 15.15.4 draws each frame into new full-canvas bitmaps, and the filter adds
more:

- `SvgView.drawOutput` allocates the output bitmap on each invalidate
  (`node_modules/react-native-svg/android/src/main/java/com/horcrux/svg/SvgView.java:280`).
- A filtered element opens a layer and allocates its own bitmap (`RenderableView.java:392-398`),
  then `FilterView.applyFilter` allocates SourceAlpha and BackgroundAlpha bitmaps, a result bitmap
  and a copy for each primitive (`FilterView.java:72-99`, `FilterUtils.java:13`).
- The mask adds offscreen layers with `saveLayer` (`RenderableView.java:423-449`).

All of this is for a filter that does nothing while the agent is online.

Two call sites also animate avatars that do not need an idle loop:

```tsx
// apps/mobile/src/features/chat/components/chat-composer.tsx:205-212 — current: up to 8 suggestions
const suggestions = query
  ? mentionAgents
      .filter((agent) =>
        `${agent.name} ${agent.title} ${agent.description}`.toLocaleLowerCase().includes(query.query.trim()),
      )
      .slice(0, 8)
  : [];
```

```tsx
// apps/mobile/src/features/chat/components/chat-composer.tsx:636-642 — current: each mention row
<BloubAvatar
  agentId={agent.id}
  serverId={agent.serverId}
  hue={agent.avatarHue}
  seed={agent.avatarSeed}
  size={28}
/>
```

Up to 8 mention avatars run the idle loop (and, before this fix, the filter) while the user types.
Other lists already pass `animateIdle={false}`: `agent-list-row.tsx:116`, `pinned-agents-grid.tsx:106`,
`search-result-row.tsx:128`.

The chat header avatar (`apps/mobile/src/features/chat/components/chat-header.tsx:97-103`) also
uses the default `animateIdle=true`. It is one avatar, and it shows the presence of the open agent.
It keeps its idle loop. Step 1 removes its filter cost.

## Target

- `filtered = disconnected || desaturated`, where `desaturated` is true while
  `appearance.saturation < 1`. The `<Filter>` definition and the `filter` prop of the `<G>` exist only
  when `filtered` is true.
  - Online → offline: `disconnected` turns true in the same render, so the filter mounts at
    saturation 1, before `useConnectionAppearance` starts its 280 ms fade. No frame shows a jump.
  - Offline → online: the filter stays while the saturation eases from 0.15 back to 1
    (`use-connection-appearance.ts:6-10`, 280 ms, `Easing.bezier(0.77, 0, 0.175, 1)`). When it
    reaches exactly 1, the filter is an identity, and removing it changes no pixel.
- Mention avatars: `animateIdle={false}`. A busy face still animates (`use-bloub-activity-frame.ts:104`
  stops only the idle loop).
- No timing, curve or color value changes.

```tsx
// apps/mobile/src/features/agents/components/bloub-avatar.tsx — target, inside AnimatedAvatarPreview
const appearance = useConnectionAppearance(disconnected);
// The filter costs several full-size bitmaps per frame on Android. Draw it only while the colour is
// below full saturation: offline, or easing back to online.
const [desaturated, setDesaturated] = useState(disconnected);
useAnimatedReaction(
  () => appearance.get().saturation < 1,
  (next, previous) => {
    if (next !== previous) scheduleOnRN(setDesaturated, next);
  },
);
const filtered = disconnected || desaturated;
```

```tsx
// target JSX
<Defs>
  {filtered ? (
    <Filter id={`${maskId}-offline`}>
      <AnimatedColorMatrix type="saturate" animatedProps={colorProps} />
    </Filter>
  ) : null}
  <Mask /* unchanged */>…</Mask>
</Defs>
{/* Mobile-only feedback: keep the synced avatar profile and color untouched. */}
<G filter={filtered ? `url(#${maskId}-offline)` : undefined}>
```

## Repo conventions to follow

- Reaction to a boolean that crosses into React state:
  `apps/mobile/src/features/chat/components/use-chat-motion.ts:349-360`
  (`if (visible !== previous) scheduleOnRN(updateAtLatest, visible);`).
- `scheduleOnRN` comes from `react-native-worklets`, as in `use-bloub-activity-frame.ts:7`.
- An offline avatar with no filter at all: `AvatarThumbnail` in the same file (`bloub-avatar.tsx:162-208`).
- The React Compiler is on. Do not read refs during render. `useState` plus a reaction is safe.

## Steps

1. `apps/mobile/src/features/agents/components/bloub-avatar.tsx`:
   - Add `useState` to the `react` import (line 4).
   - Add `useAnimatedReaction` to the `react-native-reanimated` import (lines 5-10).
   - Add `import { scheduleOnRN } from "react-native-worklets";`.
   - In `AnimatedAvatarPreview` (line 97), add the `desaturated` state, the reaction and `filtered`
     after `const appearance = …`, as in Target.
   - Render the `<Filter>` only when `filtered` (lines 118-120). Give the `<G>` (line 128) the
     `filter` prop only when `filtered`, else `undefined`. Use the exact JSX of "target JSX" above.
   - Keep the crash comment at lines 105-106 and the `appearanceStyle` opacity on the
     `Animated.View` (line 108) as they are.
2. `apps/mobile/src/features/chat/components/chat-composer.tsx:636-642`: add `animateIdle={false}`
   to the mention `BloubAvatar`, after `size={28}`.
3. Release note. Add this item under `### Changed` in `apps/mobile/changelog.d/<branch>.md`
   (`<branch>` is `git branch --show-current` with `-` for `/`):
   `- Agent avatars in the mention list stay still while you type, and online avatars draw with less work on Android.`
   If that file has uncommitted changes that are not yours, do not edit it. Put the item text in
   your report.

## Boundaries

- **Hard rule (Android crash):** never give the filtered `<G>` an `opacity` other than 1, static or
  animated, and never move the avatar opacity from the `Animated.View` back into the SVG.
  react-native-svg on Android throws "Underflow in restore" in `GroupView.drawGroup` when a filtered
  `<G>` has an opacity other than 1 (commit f3d54dd66, "Stop the Android crash when an agent avatar
  fades offline (#1990)"). Do not add `opacity` to the `<G>` even while it has no filter: the filter
  comes back when the agent goes offline.
- Do NOT change `use-connection-appearance.ts`. `chat-message-list.tsx:741` also uses it.
- Do NOT change `chat-header.tsx`. The header avatar keeps its idle loop (see Problem).
- Do NOT change `AvatarThumbnail`, `BloubAvatarThumbnail`, the mask, or the frame player.
- Do NOT touch files that have uncommitted changes from the onboarding and sign-in hand-off work:
  everything under `apps/mobile/src/features/onboarding/`, `apps/mobile/src/shared/components/loader-flight.tsx`,
  `bloub-loader.tsx`, `app-loading-overlay.tsx`, `sign-in-screen.tsx`, `connected-screen.tsx`,
  `empty-agents-scene.tsx`, `_layout.tsx` and the other files in `git status --short`.
  `empty-agents-scene.tsx` and the onboarding steps render `BloubAvatarPreview`; they get the filter
  change through `bloub-avatar.tsx` and need no edit.
- Do NOT add dependencies. Do NOT add `biome-ignore`.
- If a step does not match the code (drift since the commit stamp), STOP and report.

## Verification

- **Mechanical**, one command at a time:
  - `bunx biome check --write --max-diagnostics=none apps/mobile/src/features/agents/components/bloub-avatar.tsx apps/mobile/src/features/chat/components/chat-composer.tsx`: no errors.
  - `bun run test:related -- apps/mobile/src/features/agents/components/bloub-avatar.tsx`: all pass.
    The tests that import it mock the module, so they check only that nothing else broke.
  - Do not run the mobile typecheck by hand. The pre-commit hook runs it when the work is committed.
    Until then, say in your report that types are not verified.
- **Feel check** (Android device first, then iPhone; needs the developer's permission for a device
  build, see `apps/mobile/AGENTS.md`; if you do not have it, report the feel check as not done):
  - Open a chat with an online agent. The header avatar breathes as before and its colors are the
    same as before the change.
  - Stop the server (quit the desktop app that hosts it). The avatar fades to gray and to 60%
    opacity over about 280 ms. The app does not crash. Start the server again. The color comes back
    smoothly, with no snap at the end of the fade.
  - Repeat the offline and online change 10 times fast. No crash, no frame with full color while
    offline, no frame with gray while online after the fade ends.
  - Type `@` in the composer. The mention avatars stay still. A busy agent's face still animates.
  - Optional, with permission for `adb`: compare `adb shell dumpsys gfxinfo run.openbot.mobile`
    janky frames in a chat with an online agent, before and after the change.
- **Done when**: an online avatar renders no `<Filter>` and no `filter` prop, an offline avatar and
  an avatar that fades back to online render both, the `<G>` has no opacity, and mention avatars
  pass `animateIdle={false}`.
