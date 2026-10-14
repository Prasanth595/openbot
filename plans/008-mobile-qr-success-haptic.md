# 008 — Play the QR success haptic with the success motion

- **Status**: TODO
- **Commit**: 86f9979ef (with uncommitted onboarding and sign-in hand-off work in the tree; see Boundaries)
- **Severity**: MEDIUM
- **Category**: Haptics (feedback timing)
- **Estimated scope**: 2 files, about 15 changed lines

## Problem

`QrScanner` plays the success haptic only after the caller's `onScan` promise resolves:

```tsx
// apps/mobile/src/features/auth/components/qr-scanner.tsx:191-210 — current
async function connect(data: string): Promise<void> {
  if (!scanEnabled || scanLocked.current) return;
  scanLocked.current = true;
  scanPending.current = true;
  setScanState({ status: "connecting" });
  try {
    await onScan(data);
    completed.current = true;
    void haptics.notification("success");
  } catch (error) {
    void haptics.notification("error");
    setScanState({ /* error */ });
  } finally {
    scanPending.current = false;
  }
}
```

On the sign-in sheet, `onScan` resolves late. The sheet's `onScan` redeems the code, then awaits
`beforeConnect`, which plays the 280 ms departure (up to a 1000 ms deadline), and only then attaches
the session:

```tsx
// apps/mobile/src/features/auth/screens/sign-in-screen.tsx:519-527 — current (uncommitted file; do not edit)
onScan={async (data, beforeConnect) => {
  const session = await mobileAnalytics.operation("mobile_pairing_action", { action: "redeem" }, () =>
    redeemMobileConnectUrl(data),
  );
  try {
    await beforeConnect();
  } finally {
    connect(session);
  }
}}
```

```tsx
// apps/mobile/src/features/auth/components/scan-qr-sheet.tsx:101-124 — current: the success motion
function beforeConnect(): Promise<void> {
  if (AppState.currentState !== "active") return Promise.resolve();
  return new Promise((resolve) => {
    // A lost native callback must never prevent attachment of a redeemed session.
    const deadline = setTimeout(releaseDeparture, 1000);
    finishDeparture.current = () => {
      clearTimeout(deadline);
      resolve();
    };
    departure.set(
      withTiming(
        1,
        {
          duration: reducedMotion ? 160 : 280,
          easing: Easing.bezier(0.23, 1, 0.32, 1),
          reduceMotion: ReduceMotion.Never,
        },
        (finished) => {
          if (finished) scheduleOnRN(releaseDeparture);
        },
      ),
    );
  });
}
```

So the success motion (the panel rises and fades, the cover fades in) starts at redeem, and the
success haptic comes 280 ms or more later, after the panel is gone. Feedback that is late by a
whole animation reads as a separate event.

`QrScanner` has three users:

| Caller | `onScan` | Success visual | Haptic today |
| --- | --- | --- | --- |
| `apps/mobile/src/features/auth/components/scan-qr-sheet.tsx:219-223` (sign-in sheet) | redeem, then the 280 ms departure, then attach | departure starts after redeem | after the departure: late |
| `apps/mobile/src/features/auth/screens/scan-qr-code-screen.tsx:9-17` (route `src/app/scan-qr-code.tsx`) | redeem, then `connect` (synchronous, `mobile-session-context.tsx:36`) | the signed-in app replaces the screen | same tick as the visual: correct |
| `apps/mobile/src/features/servers/screens/scan-invite-screen.tsx:28-40` (routes `add-server/scan.tsx`, `hosted-server/scan.tsx`) | parse, then `router.dismissTo` (synchronous) | the sheet goes back to the join page | same tick as the visual: correct |

## Target

- `QrScanner` passes a second argument to `onScan`: `reportSuccess: () => void`. A caller calls it at
  the moment its success visual starts. It plays the success haptic.
- When `onScan` resolves, `QrScanner` calls `reportSuccess()` itself. A caller that never calls it
  gets the haptic at resolve, as today.
- The haptic plays exactly once per scan. Each call of `connect` has its own guard.
- `ScanQrSheet` calls `reportSuccess()` immediately before it starts the departure, in the same JS
  task as `departure.set(withTiming(…))`.
- The public `onScan` of `ScanQrSheet` does not change, so `sign-in-screen.tsx` needs no edit.
- The error haptic does not change. If `onScan` rejects after `reportSuccess`, the error card shows,
  and the error haptic plays with it.

```tsx
// apps/mobile/src/features/auth/components/qr-scanner.tsx — target
onScan: (data: string, reportSuccess: () => void) => Promise<void>;

async function connect(data: string): Promise<void> {
  if (!scanEnabled || scanLocked.current) return;
  scanLocked.current = true;
  scanPending.current = true;
  setScanState({ status: "connecting" });
  // The caller reports success when its success motion starts; resolving reports it otherwise.
  let succeeded = false;
  const reportSuccess = () => {
    if (succeeded) return;
    succeeded = true;
    void haptics.notification("success");
  };
  try {
    await onScan(data, reportSuccess);
    completed.current = true;
    reportSuccess();
  } catch (error) {
    // unchanged
  } finally {
    scanPending.current = false;
  }
}
```

```tsx
// apps/mobile/src/features/auth/components/scan-qr-sheet.tsx — target
async function scan(data: string, reportSuccess: () => void) {
  if (busyRef.current || closing.current) return;
  // Redemption consumes and stores a one-time session. Keep this surface open
  // until it settles, so a close cannot leave a saved but unattached session.
  busyRef.current = true;
  setBusy(true);
  try {
    // The redeem has succeeded when the caller asks for the departure: feel it as it starts.
    await onScan(data, () => {
      reportSuccess();
      return beforeConnect();
    });
  } finally {
    busyRef.current = false;
    setBusy(false);
  }
}
```

## Repo conventions to follow

- A callback that the caller runs at the right moment, passed through `onScan`: the sheet's own
  `beforeConnect` (`scan-qr-sheet.tsx:42` and `:157`).
- Haptics go through `haptics` from `@/shared/lib/haptics`, which respects the Haptics setting
  (`apps/mobile/src/shared/lib/haptics.ts:4-11`).
- Keep `completed.current = true` after the `await`. It controls the pairing analytics `cancel`
  event (`qr-scanner.tsx:135-143`). Do not move it.

## Steps

1. `apps/mobile/src/features/auth/components/qr-scanner.tsx`:
   - In the props type (line 124), change `onScan` to
     `onScan: (data: string, reportSuccess: () => void) => Promise<void>;`.
   - In `connect` (lines 191-210), add the `succeeded` guard and `reportSuccess`, pass it to
     `onScan`, and replace `void haptics.notification("success");` with `reportSuccess();`, as in
     Target. Keep the `catch` and `finally` blocks.
2. `apps/mobile/src/features/auth/components/scan-qr-sheet.tsx`:
   - Change `scan` (lines 150-162) as in Target. `onScan={scan}` at line 223 stays.
   - Do not change `beforeConnect`, the `ScanQrSheet` props, or any timing.
3. `scan-qr-code-screen.tsx` and `scan-invite-screen.tsx`: no change. Their `onScan` takes one
   parameter, which TypeScript accepts for a two-parameter callback type.
4. Release note. Add this item under `### Fixed` in `apps/mobile/changelog.d/<branch>.md`
   (`<branch>` is `git branch --show-current` with `-` for `/`):
   `- When you sign in with a QR code, the phone vibrates as the scanner accepts the code. Before, it vibrated after the scanner had closed.`
   If that file has uncommitted changes that are not yours, do not edit it. Put the item text in
   your report.

## Boundaries

- Do NOT edit `apps/mobile/src/features/auth/screens/sign-in-screen.tsx` or
  `apps/mobile/src/features/auth/components/scan-qr-sheet.test.tsx`. Both have uncommitted changes
  from the onboarding and sign-in hand-off work. The test already uses the real `QrScanner` and
  mocks `haptics`; it needs no change.
- Do NOT touch the other files with uncommitted hand-off changes: everything under
  `apps/mobile/src/features/onboarding/`, `loader-flight.tsx`, `bloub-loader.tsx`,
  `app-loading-overlay.tsx`, `connected-screen.tsx`, `_layout.tsx`, and the rest of
  `git status --short`.
- Do NOT change analytics events, the scan lock, the departure timing, the 1000 ms deadline, or the
  error haptic.
- Do NOT add a test. A haptic timing bug cannot lose data or break a released protocol.
- Do NOT add dependencies. Do NOT add `biome-ignore`.
- Plan 005 also edits `qr-scanner.tsx` (two Buttons) and plan 009 edits `scan-qr-sheet.tsx`. Run the
  plans one after the other, not at the same time.
- If a step does not match the code (drift since the commit stamp), STOP and report.

## Verification

- **Mechanical**, one command at a time:
  - `bunx biome check --write --max-diagnostics=none apps/mobile/src/features/auth/components/qr-scanner.tsx apps/mobile/src/features/auth/components/scan-qr-sheet.tsx`: no errors.
  - `bun run test:related -- apps/mobile/src/features/auth/components/qr-scanner.tsx`: all pass,
    including `scan-qr-sheet.test.tsx` ("attaches the session after the successful scanner exit",
    "attaches a redeemed session if the native exit callback is lost").
  - Do not run the mobile typecheck by hand. The pre-commit hook runs it when the work is committed.
    Until then, say in your report that types are not verified.
- **Feel check** (iPhone and Android device; needs the developer's permission for a device build,
  see `apps/mobile/AGENTS.md`; if you do not have it, report the feel check as not done):
  - Sign out. On the sign-in screen, tap "Scan QR code" and scan the pairing code from the desktop
    app. The vibration comes as the scanner panel starts to rise and fade, not after it is gone.
  - It vibrates once. Record the screen with sound off and note the frame of the vibration: it is
    within one or two frames of the first frame of the departure.
  - Scan an expired or used code. One error vibration comes with the error card, and no success
    vibration.
  - Add a server with an invite QR code (add-server sheet → scan). One success vibration comes as
    the sheet goes back to the join page, as before.
  - Turn off the Haptics switch in Settings: no vibration on any path.
- **Done when**: on the sign-in sheet the success haptic plays before `beforeConnect` starts the
  departure; on the other two paths it plays when `onScan` resolves, as before; and each scan plays at
  most one success haptic.
