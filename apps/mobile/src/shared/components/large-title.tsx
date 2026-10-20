import { HeaderHeightContext } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { type PropsWithChildren, useContext } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { typeScale } from "@/shared/lib/type-scale";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** The small title shows when the text of the big title reaches the bottom of the bar. */
const TITLE_BOTTOM_PADDING = 10;
/** The side room of the small title: a 44 pt bar button, 16 pt from the edge, and an 8 pt gap. */
export const BAR_TITLE_INSET = 68;

export interface LargeTitleScroll {
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  /** How far the content moved up from its rest position. Negative while iOS pulls past the top. */
  scrolled: SharedValue<number>;
  titleHeight: SharedValue<number>;
  headerHeight: number;
}

/**
 * The scroll state of a screen with a big header. The native iOS large title does not work under
 * the custom scroll edge effect on iOS 27, and Android has none, so the screens draw their own: the
 * title scrolls with the content, and a small title shows in the transparent native bar.
 */
export function useLargeTitleScroll(): LargeTitleScroll {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const scrolled = useSharedValue(0);
  const titleHeight = useSharedValue(0);
  // iOS insets the content under the transparent header, so the content rests at minus the header
  // height. Android pads the content by the header height and rests at zero.
  const rest = isIOS ? -headerHeight : 0;
  const onScroll = useAnimatedScrollHandler(
    (event) => {
      scrolled.set(event.contentOffset.y - rest);
    },
    [rest],
  );
  return { onScroll, scrolled, titleHeight, headerHeight };
}

/** The first item of the scroll content: an optional caption above the big title. */
export function LargeTitle({
  scroll,
  title,
  caption,
  accessibilityLabel,
  onPress,
}: {
  scroll: LargeTitleScroll;
  title: string;
  caption?: string;
  /** Names what a press does, for a title that is a button. */
  accessibilityLabel?: string;
  onPress?: () => void;
}) {
  const reduced = useReducedMotion();
  const titleStyle = useAnimatedStyle(() => {
    if (!isIOS || reduced) return { transform: [{ scale: 1 }] };
    // A pull past the top grows the title a little, as the native large title does.
    return {
      transform: [{ scale: interpolate(scroll.scrolled.get(), [-160, 0], [1.08, 1], Extrapolation.CLAMP) }],
    };
  });
  const heading = (
    <Animated.View style={[{ transformOrigin: "left center" }, titleStyle]}>
      <Typography.Heading weight="bold" numberOfLines={2} style={typeScale.largeTitle}>
        {title}
      </Typography.Heading>
    </Animated.View>
  );
  return (
    <View
      className="px-5"
      style={{ paddingBottom: TITLE_BOTTOM_PADDING }}
      onLayout={(event) => scroll.titleHeight.set(event.nativeEvent.layout.height)}
    >
      {caption ? (
        <Typography.Paragraph className="text-muted" numberOfLines={1} style={typeScale.caption}>
          {caption}
        </Typography.Paragraph>
      ) : null}
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          hitSlop={8}
          className="self-start"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          onPress={onPress}
        >
          {heading}
        </Pressable>
      ) : (
        <View accessible accessibilityRole="header">
          {heading}
        </View>
      )}
    </View>
  );
}

/**
 * The scroll edge effect under the transparent native bar, and the small title that comes into the
 * bar when the big title scrolls under it. The native bar buttons stay native above it.
 */
export function LargeTitleBar({
  scroll,
  title,
  hidden = false,
  insetLeft = BAR_TITLE_INSET,
  insetRight = BAR_TITLE_INSET,
  surface = "canvas",
}: {
  scroll: LargeTitleScroll;
  title: string;
  /** Hides the small title, for example while the bar shows the connection state in its place. */
  hidden?: boolean;
  insetLeft?: number;
  insetRight?: number;
  surface?: "canvas" | "sheet";
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  useAnimatedReaction(
    () => {
      const height = scroll.titleHeight.get();
      return height > 0 && scroll.scrolled.get() > height - TITLE_BOTTOM_PADDING;
    },
    (collapsed, previous) => {
      if (collapsed === previous) return;
      progress.set(withTiming(collapsed ? 1 : 0, { duration: reduced ? 150 : 200, easing: EASE_OUT }));
    },
    [reduced],
  );
  const titleStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: reduced ? 0 : (1 - progress.get()) * 4 }],
  }));
  return (
    <>
      <SheetScrollEdgeEffect
        surface={surface}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: scroll.headerHeight + (surface === "sheet" ? 48 : 20),
        }}
      />
      {hidden ? null : (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            {
              position: "absolute",
              top: insets.top,
              height: Math.max(0, scroll.headerHeight - insets.top),
              left: insetLeft,
              right: insetRight,
              justifyContent: "center",
            },
            titleStyle,
          ]}
        >
          <Typography.Paragraph weight="semibold" numberOfLines={1} style={typeScale.barTitle}>
            {title}
          </Typography.Paragraph>
        </Animated.View>
      )}
    </>
  );
}

/** A full screen of grouped content under a big header, such as Routines and Usage. */
export function LargeTitleScrollView({
  title,
  caption,
  contentContainerClassName,
  children,
}: PropsWithChildren<{ title: string; caption?: string; contentContainerClassName?: string }>) {
  const scroll = useLargeTitleScroll();
  return (
    <View className="flex-1 bg-sheet">
      <Animated.ScrollView
        className="flex-1"
        alwaysBounceVertical={false}
        contentInsetAdjustmentBehavior="always"
        contentContainerClassName="pb-safe-offset-5"
        // Android has no content inset, so the content starts below the transparent header.
        contentContainerStyle={isAndroid ? { paddingTop: scroll.headerHeight } : undefined}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        onScroll={scroll.onScroll}
      >
        <LargeTitle scroll={scroll} title={title} caption={caption} />
        <View className={contentContainerClassName}>{children}</View>
      </Animated.ScrollView>
      <LargeTitleBar scroll={scroll} title={title} surface="sheet" />
    </View>
  );
}
