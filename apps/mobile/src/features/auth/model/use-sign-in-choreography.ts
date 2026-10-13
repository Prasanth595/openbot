import { useEffect, useRef, useState } from "react";

import type { SignInStep } from "@/features/auth/model/use-email-sign-in";

/**
 * What the sign-in screen shows. The step changes at once; the stage follows it in phases, one
 * change at a time, so the eye can follow each one.
 */
export interface SignInStage {
  /** `options`: the two buttons at the top. `form`: a field slot above both buttons. */
  slots: "options" | "form";
  /** The step whose labels and title the screen shows. */
  labels: SignInStep;
  /** The field in the top slot. */
  top: "none" | "field" | "code";
  /** The "Where is the QR code?" help under the buttons. */
  help: boolean;
}

const STAGES: Record<SignInStep, SignInStage> = {
  options: { slots: "options", labels: "options", top: "none", help: true },
  email: { slots: "form", labels: "email", top: "field", help: false },
  code: { slots: "form", labels: "code", top: "code", help: false },
};

/** A change of the stage, or `focus`: the email field takes focus and the keyboard opens. */
type Phase = readonly [delayMs: number, change: Partial<SignInStage> | "focus"];

// The buttons move in 300 ms on a curve that starts fast, and their letters rearrange while they
// move. The field comes in at 160 ms, when the top slot is mostly free, so the slot is never empty
// for long. The keyboard opens only when everything has stopped: the letters settle at about
// 560 ms. The focus changes no state, so the screen does not render again while the keyboard opens:
// the keyboard animation runs on a quiet frame, as it does when the user taps the field. The way
// back closes the keyboard before the first phase.
const PHASES: Partial<Record<`${SignInStep}>${SignInStep}`, readonly Phase[]>> = {
  "options>email": [
    [0, { slots: "form", labels: "email", help: false }],
    [160, { top: "field" }],
    [640, "focus"],
  ],
  "email>options": [
    [0, { top: "none" }],
    [120, { slots: "options", labels: "options" }],
    [400, { help: true }],
  ],
  "email>code": [
    [0, { top: "code" }],
    [200, { labels: "code" }],
  ],
  // The keyboard is already open for the code, so the field takes focus at once and keeps it.
  "code>email": [
    [0, { top: "field" }],
    [0, "focus"],
    [160, { labels: "email" }],
  ],
};

/**
 * Plays the phases from the stage on the screen to `step`. Reduced motion shows the step at once.
 * `focusField` puts the cursor in the email field.
 */
export function useSignInChoreography(step: SignInStep, reduced: boolean, focusField: () => void): SignInStage {
  const [stage, setStage] = useState<SignInStage>(STAGES[step]);
  const shown = useRef(step);
  const focus = useRef(focusField);
  focus.current = focusField;
  // The field can take focus only after a render shows it: before that it is not editable. A
  // request that comes earlier waits for the effect below, which runs after that render.
  const fieldShown = useRef(stage.top === "field");
  const focusWaits = useRef(false);
  useEffect(() => {
    fieldShown.current = stage.top === "field";
    if (fieldShown.current && focusWaits.current) {
      focusWaits.current = false;
      focus.current();
    }
  }, [stage.top]);
  useEffect(() => {
    const from = shown.current;
    shown.current = step;
    const phases = PHASES[`${from}>${step}`];
    if (from === step) return;
    focusWaits.current = false;
    const requestFocus = () => {
      if (fieldShown.current) focus.current();
      else focusWaits.current = true;
    };
    if (reduced || !phases) {
      setStage(STAGES[step]);
      if (step === "email") requestFocus();
      return;
    }
    const timers = phases.map(([delay, change]) =>
      setTimeout(
        () => (change === "focus" ? requestFocus() : setStage((current) => ({ ...current, ...change }))),
        delay,
      ),
    );
    return () => {
      focusWaits.current = false;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [reduced, step]);
  return stage;
}
