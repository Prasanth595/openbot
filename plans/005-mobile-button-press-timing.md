# 005 — Make the HeroUI button press answer in 120 ms

- **Status**: TODO
- **Commit**: 86f9979ef (with uncommitted onboarding and sign-in hand-off work in the tree; see Boundaries)
- **Severity**: MEDIUM
- **Category**: Easing & duration, Cohesion & tokens
- **Estimated scope**: 1 new file (8 lines), 32 changed screens and components (65 one-line prop additions), 3 test mocks (1 line each)

## Problem

Every HeroUI Native `Button` in the mobile app wraps `PressableFeedback`. Its press scale takes
300 ms with the weak built-in ease-out, and it uses the same timing for press and release:

```ts
// node_modules/heroui-native/src/components/pressable-feedback/pressable-feedback.animation.ts:69-79 — heroui-native 1.0.8
const scaleValue = getAnimationValueProperty({
  animationValue: animationConfig,
  property: 'value',
  defaultValue: 0.985,
});

const scaleTimingConfig = getAnimationValueMergedConfig({
  animationValue: animationConfig,
  property: 'timingConfig',
  defaultValue: { duration: 300, easing: Easing.out(Easing.ease) },
});
```

```ts
// node_modules/heroui-native/src/components/pressable-feedback/pressable-feedback.animation.ts:103-112 — one timing for both directions
return {
  transform: [
    {
      scale: withTiming(
        isPressed.get() ? adjustedScaleValue.get() : 1,
        scaleTimingConfig
      ),
    },
  ],
};
```

A press is the most frequent interaction in the app. Button press feedback must be 100–160 ms. At
300 ms with a weak curve, the scale is still moving when the finger lifts, so the button feels soft
and late.

`Button` passes no scale config unless the caller gives one, so the default applies to every button:

```ts
// node_modules/heroui-native/src/components/button/button.tsx:236-250
const rootAnimation = useMemo(() => {
  if (allAnimationsDisabled) {
    return 'disable-all' as const;
  }
  if (feedbackVariant === 'none') {
    return false as const;
  }
  if (scaleAnimation === false || scaleAnimation === 'disabled') {
    return false as const;
  }
  if (typeof scaleAnimation === 'object' && scaleAnimation !== null) {
    return { scale: scaleAnimation };
  }
  return undefined;
}, [allAnimationsDisabled, feedbackVariant, scaleAnimation]);
```

There is no global timing setting. `HeroUINativeProvider` takes only `'disable-all'` for animation:

```ts
// node_modules/heroui-native/src/providers/hero-ui-native/types.ts:49
animation?: AnimationRootDisableAll;
```

```tsx
// apps/mobile/src/app/_layout.tsx:198 — current (line 160 at the commit stamp)
const heroConfig = useMemo(() => (animations ? {} : { animation: "disable-all" as const }), [animations]);
```

So each `Button` must get the timing through its own `animation` prop.

## Target

One shared constant, passed to each HeroUI `Button` as `animation={BUTTON_PRESS}`:

```ts
// apps/mobile/src/shared/lib/press-feedback.ts — target (new file)
import { Easing } from "react-native-reanimated";

/**
 * Press feedback for HeroUI `Button`. HeroUI's default scale takes 300 ms with a weak ease-out; a
 * press answers in 120 ms with the brand ease-out. HeroUI uses one timing for press and release, so
 * the release also takes 120 ms. The scale amount stays the HeroUI default.
 */
export const BUTTON_PRESS = {
  scale: { timingConfig: { duration: 120, easing: Easing.bezier(0.23, 1, 0.32, 1) } },
} as const;
```

- Press in: 120 ms, `Easing.bezier(0.23, 1, 0.32, 1)` (the strong ease-out, `--openbot-ease-out` in
  `packages/brand/src/tokens.css:353`; 120 ms is `--openbot-duration-fast` at `tokens.css:340`).
- Release: the same 120 ms and curve. HeroUI has one `timingConfig` for both directions
  (`pressable-feedback.animation.ts:103-112`). A longer release is not possible through the public
  API without a fork. 120 ms is inside the 100–160 ms budget in both directions.
- Scale amount: unchanged. Do not set `value` or `ignoreScaleCoefficient`. HeroUI keeps 0.985 with
  its width coefficient (`300 / width`).
- Highlight overlay: unchanged. The constant has only the `scale` key, because a `Button` with
  `feedbackVariant="scale"` accepts no `highlight` key (`button.types.ts:114-126`).
- Reduced motion: unchanged. HeroUI turns off all its animations for system Reduce Motion
  (`animation-settings/provider.tsx:37-38`), and `_layout.tsx` passes `'disable-all'` when the app's
  Animations switch is off.

## Repo conventions to follow

- Exemplar (uncommitted onboarding work; read it, do not edit it):
  `apps/mobile/src/features/onboarding/components/onboarding-parts.tsx:10-16` defines `PRESS_SCALE`
  with `timingConfig: { duration: 120, easing: SPLASH_EASE_OUT }` and passes it as
  `animation={PRESS_SCALE}` (`server-step.tsx:30`, `task-step.tsx:78`).
- Shared non-route helpers live in `apps/mobile/src/shared/lib/`. Import with `@/shared/lib/...`.
- Many files write the curve inline as `Easing.bezier(0.23, 1, 0.32, 1)`, for example
  `apps/mobile/src/features/chat/components/chat-activity-row.tsx:8`. Write it inline here too. Do
  not import `SPLASH_EASE_OUT` from `splash-motion.ts`: that module calls `.factory()` when it loads,
  and more test mocks would then need a `factory` stub. `splash-motion.ts` also has uncommitted
  changes.

## Steps

1. Create `apps/mobile/src/shared/lib/press-feedback.ts` with the exact content in Target.
2. In each file below, import `BUTTON_PRESS` from `@/shared/lib/press-feedback` and add
   `animation={BUTTON_PRESS}` to each HeroUI `<Button` root at the given line. Put the prop after
   `feedbackVariant` when there is one, else after `variant` or `size`. Do not change other props.
   Lines are at the commit stamp; find each root by its `<Button` opening tag.
   - `apps/mobile/src/features/agents/components/agent-appearance-picker.tsx`: 135, 151, 188, 205
   - `apps/mobile/src/features/agents/components/agent-information.tsx`: 440, 480
   - `apps/mobile/src/features/agents/components/agent-photo-picker.tsx`: 50, 63
   - `apps/mobile/src/features/agents/components/agent-publish.tsx`: 51
   - `apps/mobile/src/features/agents/components/agent-runtime-fields.tsx`: 157
   - `apps/mobile/src/features/agents/components/agent-shared-tables.tsx`: 39
   - `apps/mobile/src/features/agents/components/routine-webhook-trigger.tsx`: 86, 223, 289, 300
   - `apps/mobile/src/features/auth/components/qr-scanner.tsx`: 48, 256
   - `apps/mobile/src/features/auth/components/scan-qr-button.tsx`: 16
   - `apps/mobile/src/features/auth/components/scanner-close-button.tsx`: 16
   - `apps/mobile/src/features/auth/components/sign-in-choices.tsx`: 77
   - `apps/mobile/src/features/browser/screens/browser-screen.tsx`: 477
   - `apps/mobile/src/features/chat/components/attachment-preview-sheet.tsx`: 95
   - `apps/mobile/src/features/chat/components/browser-secret-card.tsx`: 56, 113, 125, 221
   - `apps/mobile/src/features/chat/components/chat-approval-card.tsx`: 172, 177
   - `apps/mobile/src/features/chat/components/chat-attachment.tsx`: 192, 237
   - `apps/mobile/src/features/chat/components/chat-camera-panel.tsx`: 112, 125, 133
   - `apps/mobile/src/features/chat/components/chat-code-block.tsx`: 76
   - `apps/mobile/src/features/chat/components/chat-composer.tsx`: 620, 816
   - `apps/mobile/src/features/chat/components/chat-image-generation.tsx`: 199
   - `apps/mobile/src/features/chat/components/chat-message-gesture.tsx`: 68
   - `apps/mobile/src/features/chat/components/chat-message-list.tsx`: 514, 1039, 1066
   - `apps/mobile/src/features/chat/components/chat-question-prompt.tsx`: 69, 85, 95, 109, 143, 176, 211, 238
   - `apps/mobile/src/features/chat/screens/queued-message-edit-screen.tsx`: 241
   - `apps/mobile/src/features/chat/screens/queued-messages-screen.tsx`: 39
   - `apps/mobile/src/features/links/screens/agent-template-install-screen.tsx`: 169
   - `apps/mobile/src/features/links/screens/incoming-link-screen.tsx`: 132, 137, 149
   - `apps/mobile/src/features/search/screens/search-agents-screen.tsx`: 397, 497, 520
   - `apps/mobile/src/features/servers/screens/add-server-screen.tsx`: 183, 258, 264
   - `apps/mobile/src/features/servers/screens/hosted-server-plans-screen.tsx`: 74
   - `apps/mobile/src/features/servers/screens/hosted-server-setup-screen.tsx`: 240, 251
   - `apps/mobile/src/features/servers/screens/server-usage-screen.tsx`: 92

   Total: 65 roots. To check the count, run
   `grep -rnE "<Button(\s|>|$)" apps/mobile/src` and remove the skipped files listed in Boundaries.
3. Three tests mock `react-native-reanimated` with no `Easing`. They import a file from step 2, so the
   new module fails when it loads (`[vitest] No "Easing" export is defined on the "react-native-reanimated" mock`).
   Add this one line to the object that each mock returns:
   `Easing: { bezier: () => (value: number) => value },`
   - `apps/mobile/src/features/chat/components/chat-attachment.test.tsx` (mock at the top of the file)
   - `apps/mobile/src/features/chat/components/chat-camera-panel.test.tsx` (mock at the top of the file)
   - `apps/mobile/src/features/chat/context/message-actions-context.test.tsx` (async mock; add the key to the returned object)

   If the test run in Verification shows the same error in another test, add the same line to that
   test's mock. Make no other test change.
4. Release note. Add this item under `### Changed` in `apps/mobile/changelog.d/<branch>.md`
   (`<branch>` is `git branch --show-current` with `-` for `/`):
   `- Buttons now answer a press at once. Before, the press shrink took 300 ms and felt late.`
   If that file has uncommitted changes that are not yours, do not edit it. Put the item text in
   your report.

## Boundaries

- Do NOT edit or patch anything under `node_modules`. Do not add a `patchedDependencies` entry.
- Do NOT wrap or re-export HeroUI `Button` in a new component. Pass the prop at each call site.
- Do NOT touch files that have uncommitted changes from the onboarding and sign-in hand-off work.
  At the commit stamp these are: everything under `apps/mobile/src/features/onboarding/`,
  `apps/mobile/src/shared/components/loader-flight.tsx`, `bloub-loader.tsx`, `app-loading-overlay.tsx`
  and its test, `apps/mobile/src/features/auth/screens/sign-in-screen.tsx`,
  `apps/mobile/src/features/agents/screens/connected-screen.tsx`,
  `apps/mobile/src/features/agents/components/empty-agents-scene.tsx`,
  `apps/mobile/src/features/auth/components/scan-qr-sheet.test.tsx`,
  `apps/mobile/src/features/auth/model/use-email-sign-in.ts`,
  `apps/mobile/src/features/workspace/context/mobile-workspace-context.tsx`,
  `apps/mobile/src/features/workspace/model/workspace-types.ts`,
  `apps/mobile/src/shared/lib/splash-motion.ts`, `apps/mobile/src/app/_layout.tsx`, and the
  `packages/i18n/src/messages/*/mobile*` files. Run `git status --short` first. Skip any file of step 2
  that has changes you did not make, and list it in your report.
- Skipped on purpose: the Buttons in `connected-screen.tsx` (4), `empty-agents-scene.tsx` (1) and
  `onboarding-parts.tsx` (2). Add `BUTTON_PRESS` there in a follow-up after the onboarding work is
  committed. The `@expo/ui/swift-ui` Buttons in `scanner-close-button.ios.tsx` and
  `server-drawer-icon-button.ios.tsx` are native SwiftUI controls. They have no HeroUI scale.
- Do NOT change the scale amount (`value`, `ignoreScaleCoefficient`), the highlight or the ripple.
  Note for the developer: the HeroUI width coefficient makes small icon buttons shrink much more
  than wide ones (about 0.875 at 36 pt wide). That is a separate decision.
- Do NOT change `feedbackVariant`, layout or markup.
- Do NOT add dependencies. Do NOT add `biome-ignore`.
- If a step does not match the code (drift since the commit stamp), STOP and report.

## Verification

- **Mechanical**, one command at a time:
  - `bunx biome check --write --max-diagnostics=none <each changed file>`: no errors.
  - `bun run test:related -- apps/mobile/src/shared/lib/press-feedback.ts`: it runs, on one worker,
    the tests that import a changed button file. All pass after step 3.
  - Do not run the mobile typecheck by hand. The pre-commit hook runs it when the work is committed.
    Until then, say in your report that types are not verified.
- **Feel check** (device; needs the developer's permission for a device build, see
  `apps/mobile/AGENTS.md`; if you do not have it, report the feel check as not done):
  - Tap a large button (the Allow and Deny buttons of a chat approval card, the `size="lg"` buttons
    on the Add server page). The shrink is complete before the finger lifts in a quick tap. It does
    not drift after release.
  - Tap an icon-only button (the copy button of a chat code block). It reacts at the same speed as
    the large buttons.
  - Tap quickly many times on one button. The scale follows each touch and never lags a tap behind.
  - Record the screen at 120 fps or step a screen recording frame by frame: press-in reaches its
    end in about 120 ms (about 7 frames at 60 Hz, 15 at 120 Hz).
  - Turn on system Reduce Motion, then turn off Settings → Animations: no button scales.
- **Done when**: each HeroUI `Button` root outside the skipped files has `animation={BUTTON_PRESS}`,
  the related tests pass, and no file under `node_modules` changed.
