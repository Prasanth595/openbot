import { Easing, FadeIn, FadeInUp, FadeOut, Keyframe } from "react-native-reanimated";

/** Strong ease-out for elements that enter or leave. */
export const SIGN_IN_EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/**
 * The iOS sheet curve for elements that move to another place. It starts at once and settles
 * without overshoot. The sign-in buttons use the same curve as a CSS transition.
 */
export const SIGN_IN_EASE_MOVE = Easing.bezier(0.32, 0.72, 0, 1);

/** A soft, symmetric curve for text that changes in place. */
export const SIGN_IN_TEXT_EASE = Easing.bezier(0.45, 0, 0.55, 1);
// The old text leaves first; the new one starts when the old one is nearly gone, so two texts never
// show at full strength together. A 3 pt drift gives the change a direction without a jump.
export const SIGN_IN_TEXT_OUT = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -3 }], easing: SIGN_IN_TEXT_EASE },
}).duration(180);
export const SIGN_IN_TEXT_IN = FadeInUp.duration(260)
  .delay(140)
  .easing(SIGN_IN_TEXT_EASE)
  .withInitialValues({ opacity: 0, transform: [{ translateY: 3 }] });

const ENTER_MS = 220;
const EXIT_MS = 120;
const RISE = 8;

/**
 * The entrances and fades of the sign-in screen. Built-in animations apply their start values
 * before any delay, so a staggered element never shows for a frame before it animates. Reduced
 * motion keeps the fades and drops all movement.
 */
export function signInMotion(reduced: boolean) {
  const fadeIn = (delay = 0) =>
    FadeIn.duration(ENTER_MS)
      .delay(reduced ? 0 : delay)
      .easing(SIGN_IN_EASE_OUT);
  return {
    /** An element that rises into place. `delay` staggers a group. */
    enter: (delay = 0) =>
      reduced
        ? fadeIn()
        : FadeInUp.duration(ENTER_MS)
            .delay(delay)
            .easing(SIGN_IN_EASE_OUT)
            .withInitialValues({ opacity: 0, transform: [{ translateY: RISE }] }),
    /** A cross-fade in place, for text that changes but keeps its position. */
    fadeIn,
    fadeOut: FadeOut.duration(EXIT_MS),
    /** A paragraph that changes in place: out, then in. */
    textIn: reduced ? undefined : SIGN_IN_TEXT_IN,
    textOut: reduced ? undefined : SIGN_IN_TEXT_OUT,
    /** False when movement must not play: reduced motion, or during the splash hand-off. */
    moves: !reduced,
  };
}

export type SignInMotion = ReturnType<typeof signInMotion>;
