import { useEffect, useRef } from "react";
import { type ColorValue, TextInput, useWindowDimensions } from "react-native";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/** The body text uses the same size as the rendered message. */
const FONT_SIZE = 16;
/** The natural line height of Inter, as a multiple of its size: (1984 + 494) / 2048. */
const FONT_LINE_RATIO = 1.21;
/**
 * The text of a message while the reader selects part of it in the bubble.
 *
 * iOS `Text` copies only a whole message, and `Text` on either platform does not report the
 * selected range, so a read-only text field covers the message text. It has the size and line
 * height of the body text, so the words stay where they are. It opens with all text selected;
 * the platform handles change the range, and the system menu has Copy and Select All.
 */
export function ChatSelectableText({
  text,
  color,
  lineHeight,
  onHeight,
  onSelectionChange,
}: {
  text: string;
  color: ColorValue | undefined;
  lineHeight: number;
  /** The height of the text, so the bubble grows when the plain text is longer than the message. */
  onHeight: (height: number) => void;
  /** The selected part of `text`. Empty when the selection is only a cursor. */
  onSelectionChange: (selected: string) => void;
}) {
  const { t } = useText();
  const { fontScale } = useWindowDimensions();
  // A text field places the extra line space above its letters; Text centres that space.
  const baselineShift = (lineHeight - FONT_SIZE * FONT_LINE_RATIO) / 2;
  const input = useRef<TextInput>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.setSelection(0, text.length);
  }, [text]);
  return (
    <TextInput
      ref={input}
      accessibilityLabel={t("mobile.chat.message.text")}
      value={text}
      multiline
      scrollEnabled={false}
      // Android disables a field that cannot be edited, and a disabled field selects nothing. There
      // the field stays editable with no keyboard, and `value` puts back any change.
      editable={!isIOS}
      showSoftInputOnFocus={false}
      caretHidden
      onContentSizeChange={({ nativeEvent }) => onHeight(nativeEvent.contentSize.height)}
      onSelectionChange={({ nativeEvent }) =>
        onSelectionChange(text.slice(nativeEvent.selection.start, nativeEvent.selection.end))
      }
      className="absolute left-0 right-0 top-0 bg-transparent p-0 font-sans"
      style={{
        color,
        fontSize: FONT_SIZE,
        lineHeight,
        transform: isIOS ? [{ translateY: -baselineShift * fontScale }] : undefined,
      }}
    />
  );
}
