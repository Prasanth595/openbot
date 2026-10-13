import { Button } from "heroui-native";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { type TextLayoutEvent, View } from "react-native";
import Animated, { Easing, FadeIn, FadeInUp, FadeOut, Keyframe, LinearTransition } from "react-native-reanimated";

// A soft, symmetric curve: the letters drift into place without a fast start.
const SOFT = Easing.bezier(0.45, 0, 0.55, 1);
const MOVE_MS = 360;
const CHAR_MOVE = LinearTransition.duration(MOVE_MS).easing(SOFT);
const CHAR_OUT = FadeOut.duration(160).easing(SOFT);
const CHAR_IN = FadeIn.duration(220).delay(140).easing(SOFT);
// The animation props come off when every letter is in place. The letters stay mounted.
const SETTLE_MS = MOVE_MS + 200;
// A text that cannot change letter by letter fades: out first, then the new text in.
const TEXT_OUT = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -3 }], easing: SOFT },
}).duration(180);
const TEXT_IN = FadeInUp.duration(260)
  .delay(140)
  .easing(SOFT)
  .withInitialValues({ opacity: 0, transform: [{ translateY: 3 }] });

type Morph = { from: string; to: string; stage: "from" | "to" };
type TextProps = { onTextLayout?: (event: TextLayoutEvent) => void };

/**
 * A text that rearranges its letters into a new text. Letters that both texts share move to their
 * new places; the others fade out or in. The letters stay separate at rest too: one native text
 * lays out its glyphs with kerning, so replacing the letters with it at the end would make every
 * letter jump. A change that keeps `morphKey`, such as a countdown tick, updates the text in place.
 *
 * Separate letters cannot break a line between words. With `measure`, a hidden copy checks that
 * the text fits on one line; a text that needs more lines stays one native text and fades instead.
 */
export function MorphText({
  text,
  morphKey,
  reduced,
  renderText,
  renderLetter,
  measure = false,
}: {
  text: string;
  morphKey: string;
  reduced: boolean;
  /** The text as one native text: for a text that wraps, and for the measuring copy. */
  renderText: (text: string, props?: TextProps) => ReactNode;
  /** One letter, in the same style as `renderText`. */
  renderLetter: (letter: string) => ReactNode;
  /** Check that the text fits on one line. Without it, the text is assumed to fit. */
  measure?: boolean;
}) {
  const [lines, setLines] = useState<Record<string, number>>({});
  const fits = (value: string) => !measure || (lines[value] ?? 1) === 1;
  const [morph, setMorph] = useState<Morph | null>(null);
  const last = useRef({ text, key: morphKey });
  // A new key arrives in this render. Until the layout effect starts the morph, keep showing the
  // old letters, so the new letters never show for a frame before they animate.
  const starting = !reduced && last.current.key !== morphKey && last.current.text !== text;
  const startingFrom = last.current.text;

  useLayoutEffect(() => {
    const previous = last.current;
    last.current = { text, key: morphKey };
    if (reduced || previous.key === morphKey || previous.text === text) {
      // A change in place, such as a countdown tick, ends any morph that it interrupts: the
      // cleanup below stopped its timer.
      setMorph(null);
      return;
    }
    // First the old letters with their animation props, then the new letters, so each shared
    // letter keeps its view and moves.
    setMorph({ from: previous.text, to: text, stage: "from" });
    const frame = requestAnimationFrame(() => setMorph((current) => (current ? { ...current, stage: "to" } : current)));
    const settle = setTimeout(() => setMorph(null), SETTLE_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [morphKey, reduced, text]);

  const measuring = measure ? (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute inset-x-0 top-0 opacity-0"
    >
      {renderText(text, {
        onTextLayout: ({ nativeEvent }) => {
          const count = nativeEvent.lines.length;
          setLines((current) => (current[text] === count ? current : { ...current, [text]: count }));
        },
      })}
    </View>
  ) : null;

  const shown = morph?.stage === "to" ? morph.to : (morph?.from ?? (starting ? startingFrom : text));
  if (!fits(shown) || !fits(text) || (morph && !fits(morph.from))) {
    return (
      <View className="w-full">
        {measuring}
        <Animated.View key={morphKey} entering={reduced ? undefined : TEXT_IN} exiting={reduced ? undefined : TEXT_OUT}>
          {renderText(text)}
        </Animated.View>
      </View>
    );
  }
  const animate = morph !== null;
  const seen = new Map<string, number>();
  return (
    <View className={measure ? "w-full" : undefined}>
      {measuring}
      <View
        className="flex-row justify-center"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {[...shown].map((letter) => {
          const occurrence = seen.get(letter) ?? 0;
          seen.set(letter, occurrence + 1);
          return (
            <Animated.View
              key={`${letter}-${occurrence}`}
              layout={animate ? CHAR_MOVE : undefined}
              entering={morph?.stage === "to" ? CHAR_IN : undefined}
              exiting={animate ? CHAR_OUT : undefined}
            >
              {renderLetter(letter === " " ? " " : letter)}
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * A button label that rearranges its letters into a new label. The QR scanner draws a copy of the
 * Scan QR code button with this same label, so the copy matches the button letter for letter.
 */
export function MorphLabel({
  text,
  morphKey,
  color,
  dimmed = false,
  reduced,
}: {
  text: string;
  morphKey: string;
  color: string;
  dimmed?: boolean;
  reduced: boolean;
}) {
  const style = { color, opacity: dimmed ? 0.5 : 1 };
  const label = (content: string, props?: TextProps) => (
    <Button.Label className="font-sans font-semibold" style={style} {...props}>
      {content}
    </Button.Label>
  );
  return <MorphText text={text} morphKey={morphKey} reduced={reduced} renderText={label} renderLetter={label} />;
}
