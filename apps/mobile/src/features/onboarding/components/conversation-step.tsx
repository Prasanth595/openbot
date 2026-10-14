import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type ReactNode, useEffect, useRef } from "react";
import { Keyboard, ScrollView, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SpeechBubble, TYPING_MS } from "@/features/onboarding/components/onboarding-bubble";
import { GlassChoice } from "@/features/onboarding/components/onboarding-glass";
import { HeroSlot } from "@/features/onboarding/components/onboarding-hero";
import {
  glassAfter,
  type OnboardingMotion,
  popEntering,
  STAGGER_MS,
} from "@/features/onboarding/components/onboarding-motion";
import { STEP_TOP_GAP } from "@/features/onboarding/components/onboarding-parts";
import { haptics } from "@/shared/lib/haptics";

const HEADER_HERO_SIZE = 56;

/**
 * A step that reads as the first chat with the new agent: the agent in the header, its question in
 * a bubble, replies to choose from, and a field at the bottom to write one's own. The replies come
 * after the agent has finished "typing".
 */
export function ConversationStep({
  motion,
  name,
  caption,
  question,
  hint,
  ideas,
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  color,
  disabled,
  children,
}: {
  motion: OnboardingMotion;
  name: string;
  /** The role under the name, or null. */
  caption: string | null;
  question: string;
  hint?: string;
  /** Replies, already in the reader's language. */
  ideas: readonly string[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  maxLength: number;
  /** The colour of the agent. */
  color: string;
  disabled: boolean;
  /** Errors and actions under the replies. */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const repliesAt = STAGGER_MS + TYPING_MS;
  // With the keyboard open, the ideas belong right above the field. While the field is in use, the
  // conversation keeps its end in view as the keyboard shrinks it, so the field never cuts them.
  const scroller = useRef<ScrollView>(null);
  const composing = useRef(false);
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () =>
      scroller.current?.scrollToEnd({ animated: true }),
    );
    return () => subscription.remove();
  }, []);
  return (
    <View className="flex-1" style={{ paddingTop: insets.top + STEP_TOP_GAP }}>
      <View className="flex-row items-center gap-3 px-6">
        <HeroSlot size={HEADER_HERO_SIZE} />
        <Animated.View entering={popEntering(motion, STAGGER_MS)} className="min-w-0 flex-1">
          <Typography.Heading type="h4" numberOfLines={1}>
            {name}
          </Typography.Heading>
          {caption ? (
            <Typography type="body-sm" numberOfLines={1} className="text-text-secondary">
              {caption}
            </Typography>
          ) : null}
        </Animated.View>
      </View>
      <ScrollView
        ref={scroller}
        onLayout={() => {
          if (composing.current) scroller.current?.scrollToEnd({ animated: false });
        }}
        className="flex-1"
        contentContainerClassName="grow gap-4 px-6 pt-4 pb-4"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
      >
        <SpeechBubble motion={motion} tail="top" delay={STAGGER_MS} text={question} />
        {hint ? (
          <Animated.View entering={popEntering(motion, repliesAt)}>
            <Typography.Paragraph type="body-sm" color="muted">
              {hint}
            </Typography.Paragraph>
          </Animated.View>
        ) : null}
        <View className="items-end gap-2">
          {ideas.map((idea, index) => {
            const chosen = value === idea;
            return (
              <View key={idea} className="max-w-[86%]">
                <GlassChoice
                  appearDelay={glassAfter(repliesAt + (index + 1) * STAGGER_MS)}
                  label={idea}
                  selected={chosen}
                  disabled={disabled}
                  color={color}
                  radius={22}
                  onPress={() => {
                    void haptics.selection();
                    onChange(idea);
                  }}
                >
                  <Typography type="body-sm" className="px-4 py-3 font-medium">
                    {idea}
                  </Typography>
                </GlassChoice>
              </View>
            );
          })}
        </View>
        {children}
      </ScrollView>
      <View className="px-6 pb-1">
        <TextInput
          multiline
          editable={!disabled}
          value={value}
          onChangeText={onChange}
          onFocus={() => {
            composing.current = true;
          }}
          onBlur={() => {
            composing.current = false;
          }}
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={String(muted)}
          maxLength={maxLength}
          cursorColor={color}
          selectionColor={color}
          textAlignVertical="top"
          className="font-sans text-[17px]"
          style={{ color: String(foreground), maxHeight: 132, paddingVertical: 12 }}
        />
      </View>
    </View>
  );
}
