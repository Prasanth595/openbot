import { useIsFocused } from "expo-router/react-navigation";
import { Accordion, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type LucideIcon, X } from "lucide-react-native";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard, Pressable, ScrollView, type TextInput, useWindowDimensions, View } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { redeemMobileConnectUrl } from "@/features/auth/api/mobile-auth";
import { AppLogo } from "@/features/auth/components/app-logo";
import type { EmailCodeInputHandle } from "@/features/auth/components/email-code-input";
import { MorphText } from "@/features/auth/components/morph-text";
import { type ScannerOrigin, ScanQrSheet } from "@/features/auth/components/scan-qr-sheet";
import { SignInControls } from "@/features/auth/components/sign-in-controls";
import { SIGN_IN_EASE_MOVE, type SignInMotion, signInMotion } from "@/features/auth/components/sign-in-motion";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { type SignInStep, useEmailSignIn } from "@/features/auth/model/use-email-sign-in";
import { useSignInChoreography } from "@/features/auth/model/use-sign-in-choreography";
import { SplashWallpaper } from "@/shared/components/splash-backdrop";
import { useReducedMotion } from "@/shared/lib/motion";
import { SPLASH_LOGO_SIZE, SPLASH_MORPH_START, splashReveal, splashTravel } from "@/shared/lib/splash-motion";
import { useText } from "@/shared/lib/text";
import {
  SPLASH_HANDOFF_DEADLINE_MS,
  SplashContentReadyContext,
  SplashMotionContext,
} from "@/shared/lib/use-splash-gate";

const HERO_SIZE = 72;
const HELP_GAP = 12;
// The widest sign-in column: the field, both buttons and the eight code slots share this width.
const FORM_MAX_WIDTH = 340;
// The side margin of the sign-in column. The code needs the width for eight slots.
const SIDE_MARGIN = 24;
// Space between the lowest control and the keyboard.
const KEYBOARD_GAP = 24;
// The lift moves with the slots, with the same curve and duration.
const LIFT_MOVE = { duration: 300, easing: SIGN_IN_EASE_MOVE };

function useContentReveal(delay: number) {
  const motion = useContext(SplashMotionContext);
  const progress = motion?.progress;
  const reducedMotion = motion?.reducedMotion ?? false;
  return useAnimatedStyle(() => {
    const opacity = progress ? splashReveal(progress.get(), delay, reducedMotion) : 1;
    return { opacity, transform: [{ translateY: reducedMotion ? 0 : (1 - opacity) * 8 }] };
  });
}

/** A link that waits for sign-in, such as an invitation. A banner above the sign-in content names it. */
export interface SignInNotice {
  icon: LucideIcon;
  title: string;
  description: string;
  cancelLabel: string;
  onCancel: () => void;
}

const BANNER_GAP = 12;

function SignInNoticeBanner({ notice, disabled }: { notice: SignInNotice; disabled: boolean }) {
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  const Icon = notice.icon;
  return (
    <View className="flex-row items-start gap-3 rounded-grouped bg-grouped py-3 pr-2 pl-3">
      <View className="size-9 items-center justify-center rounded-full bg-background">
        <Icon size={18} color={foreground} strokeWidth={1.75} />
      </View>
      <View accessible accessibilityRole="summary" className="min-w-0 flex-1 gap-0.5 py-0.5">
        <Typography.Paragraph className="font-medium">{notice.title}</Typography.Paragraph>
        <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
          {notice.description}
        </Typography.Paragraph>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={notice.cancelLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={8}
        onPress={notice.onCancel}
        className="size-8 items-center justify-center rounded-full"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <X size={18} color={muted} strokeWidth={1.75} />
      </Pressable>
    </View>
  );
}

type TitleTexts = Record<SignInStep, readonly [heading: string, subtitle: string]>;

/**
 * The title and subtitle of the step. The title rearranges its letters, as the button labels do;
 * the subtitle fades out and the new one fades in. Neither block moves. The block keeps the height
 * of its tallest text, so a subtitle of another length cannot push the controls under it.
 */
function SignInTitle({
  step,
  texts,
  motion,
  reduced,
}: {
  step: SignInStep;
  texts: TitleTexts;
  motion: SignInMotion;
  reduced: boolean;
}) {
  const [heights, setHeights] = useState<Partial<Record<SignInStep, number>>>({});
  // The code text names the address, which changes while the user types it. Measure it only on
  // its own step, so typing never changes the height.
  const measured = step === "code" ? (["options", "email", "code"] as const) : (["options", "email"] as const);
  const minHeight = Math.max(0, ...measured.map((key) => heights[key] ?? 0));
  const record = (key: SignInStep, height: number) =>
    setHeights((current) => (current[key] === height ? current : { ...current, [key]: height }));
  const block = (key: SignInStep) => (
    <>
      <Typography.Heading type="h2" accessibilityRole="header" align="center" className="tracking-openbot-tight">
        {texts[key][0]}
      </Typography.Heading>
      <Typography.Paragraph color="muted" align="center">
        {texts[key][1]}
      </Typography.Paragraph>
    </>
  );
  return (
    <View style={{ minHeight }}>
      {/* Invisible copies measure the other steps. The visible step measures itself. */}
      {measured
        .filter((key) => key !== step)
        .map((key) => (
          <View
            key={`measure-${key}`}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="absolute inset-x-0 top-0 items-center gap-3 opacity-0"
            onLayout={({ nativeEvent: { layout } }) => record(key, layout.height)}
          >
            {block(key)}
          </View>
        ))}
      <View className="items-center gap-3" onLayout={({ nativeEvent: { layout } }) => record(step, layout.height)}>
        {/* The letters are hidden from screen readers; this view reads the title as one header. */}
        <View accessible accessibilityRole="header" accessibilityLabel={texts[step][0]} className="w-full">
          <MorphText
            text={texts[step][0]}
            morphKey={step}
            reduced={reduced}
            measure
            renderText={(text, props) => (
              <Typography.Heading type="h2" align="center" className="tracking-openbot-tight" {...props}>
                {text}
              </Typography.Heading>
            )}
            renderLetter={(letter) => (
              <Typography.Heading type="h2" className="tracking-openbot-tight">
                {letter}
              </Typography.Heading>
            )}
          />
        </View>
        <Animated.View key={step} entering={motion.textIn} exiting={motion.textOut}>
          <Typography.Paragraph color="muted" align="center">
            {texts[step][1]}
          </Typography.Paragraph>
        </Animated.View>
      </View>
    </View>
  );
}

export function SignInScreen({ notice }: { notice?: SignInNotice }) {
  const { t } = useText();
  const reportContentReady = useContext(SplashContentReadyContext);
  const motion = useContext(SplashMotionContext);
  const insets = useSafeAreaInsets();
  const titleStyle = useContentReveal(280);
  const actionsStyle = useContentReveal(340);
  const hero = useRef<View>(null);
  const [heroOffset, setHeroOffset] = useState({ x: 0, y: 0 });
  const progress = motion?.progress;
  const reduced = motion?.reducedMotion ?? false;
  const heroStyle = useAnimatedStyle(() => {
    const p = progress ? splashTravel(progress.get(), reduced) : 1;
    return {
      opacity: reduced ? p : Math.max(0, (p - SPLASH_MORPH_START) / (1 - SPLASH_MORPH_START)),
      transform: [
        { translateX: reduced ? 0 : heroOffset.x * (1 - p) },
        { translateY: reduced ? 0 : heroOffset.y * (1 - p) },
        { scale: reduced ? 1 : 1 + (SPLASH_LOGO_SIZE / HERO_SIZE - 1) * (1 - p) },
      ],
    };
  });
  const isFocused = useIsFocused();
  const { width: windowWidth } = useWindowDimensions();
  const formWidth = Math.min(FORM_MAX_WIDTH, windowWidth - 2 * SIDE_MARGIN);
  const { connect } = useMobileSession();
  const reducedMotion = useReducedMotion();
  const signIn = useEmailSignIn({ connect, reduced: reducedMotion });
  const { step } = signIn;
  // The step changes at once; the stage on the screen follows it one phase at a time.
  const emailInput = useRef<TextInput>(null);
  const stage = useSignInChoreography(step, reducedMotion, () => emailInput.current?.focus());
  // Layout changes glide only after the splash: its hand-off measures the first layout.
  const settled = motion?.complete ?? true;
  const stepMotion = useMemo(() => {
    const base = signInMotion(reducedMotion);
    return settled ? base : { ...base, moves: false };
  }, [reducedMotion, settled]);
  const codeInput = useRef<EmailCodeInputHandle>(null);
  const back = useRef(signIn.back);
  back.current = signIn.back;
  const measurementDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<View>(null);
  const button = useRef<View>(null);
  const [origin, setOrigin] = useState<ScannerOrigin | null>(null);
  const scannerOpen = origin !== null;
  const animationActive = isFocused && !scannerOpen && (motion?.complete ?? true);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [mainHeight, setMainHeight] = useState(0);
  // The height of the sign-in choices. The email and code steps keep this anchor, so the logo and
  // the title stay still and only the controls under them move.
  const [anchorHeight, setAnchorHeight] = useState(0);
  const [helpTriggerHeight, setHelpTriggerHeight] = useState(0);
  // Centre the closed composition. Expanded help adds scrollable content below it.
  const closedHeight = (anchorHeight || mainHeight) + HELP_GAP + helpTriggerHeight;
  // A link banner takes the top of the screen; the sign-in content is centred in the space below it.
  const [bannerHeight, setBannerHeight] = useState(0);
  const bannerSpace = notice ? bannerHeight + BANNER_GAP : 0;
  const top = insets.top + bannerSpace;
  const contentTop = top + Math.max(32, (viewport.height - top - insets.bottom - closedHeight) / 2);
  const closeScanner = useCallback(() => {
    setOrigin(null);
  }, []);

  // The keyboard covers the lower half. Lift the composition just enough to keep its lowest control
  // above the keyboard, and never past the top inset. The lift follows the keyboard frame by frame.
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const liftAnchor = useSharedValue(0);
  const liftCeiling = useSharedValue(0);
  useEffect(() => {
    const anchor = contentTop + mainHeight + KEYBOARD_GAP;
    const ceiling = Math.max(0, contentTop - insets.top - 12);
    liftAnchor.set(stepMotion.moves ? withTiming(anchor, LIFT_MOVE) : anchor);
    liftCeiling.set(stepMotion.moves ? withTiming(ceiling, LIFT_MOVE) : ceiling);
  }, [contentTop, insets.top, liftAnchor, liftCeiling, mainHeight, stepMotion.moves]);
  const viewportHeight = viewport.height;
  const liftStyle = useAnimatedStyle(() => {
    const overlap = liftAnchor.get() - (viewportHeight - Math.abs(keyboardHeight.get()));
    return { transform: [{ translateY: -Math.min(liftCeiling.get(), Math.max(0, overlap)) }] };
  });

  // The keyboard belongs to the last phase: the choreography focuses the field when the screen has
  // stopped moving. On the way back the keyboard closes first.
  useEffect(() => {
    if (stage.top === "none") Keyboard.dismiss();
  }, [stage.top]);

  // A new code unlocks the slots again. Put the cursor back in them.
  useEffect(() => {
    if (step === "code" && signIn.challenge && !signIn.needsNewCode) codeInput.current?.focus();
  }, [signIn.challenge, signIn.needsNewCode, step]);

  // The Android back button returns one step before it leaves the screen.
  useEffect(() => {
    if (step === "options") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      back.current();
      return true;
    });
    return () => subscription.remove();
  }, [step]);

  const reportHero = useCallback(() => {
    if (viewport.height <= 0 || viewport.width <= 0 || mainHeight <= 0 || helpTriggerHeight <= 0) return;
    root.current?.measureInWindow((rootX, rootY, width, height) => {
      hero.current?.measureInWindow((x, y, heroWidth) => {
        if (heroWidth <= 0) return;
        setHeroOffset({ x: rootX + width / 2 - x - heroWidth / 2, y: rootY + height / 2 - y - heroWidth / 2 });
        reportContentReady({ x, y, size: heroWidth });
      });
    });
  }, [reportContentReady, viewport.height, viewport.width, mainHeight, helpTriggerHeight]);

  useLayoutEffect(() => {
    if (viewport.height <= 0 || motion?.revealing) return;
    // Measurement normally completes with layout. A missing native callback must
    // degrade to a fade, never strand the user behind the splash.
    measurementDeadline.current = setTimeout(() => reportContentReady(), SPLASH_HANDOFF_DEADLINE_MS);
    reportHero();
    return () => {
      if (measurementDeadline.current) clearTimeout(measurementDeadline.current);
    };
  }, [motion?.revealing, reportContentReady, reportHero, viewport.height]);

  function openScanner() {
    motion?.finish();
    root.current?.measureInWindow((rootX, rootY) => {
      button.current?.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) return;
        setOrigin({ x: x - rootX, y: y - rootY, width, height });
      });
    });
  }

  return (
    <View
      ref={root}
      className="flex-1 bg-background"
      collapsable={false}
      onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}
    >
      <SplashWallpaper />
      <ScrollView
        onScrollBeginDrag={motion?.finish}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!scannerOpen}
        pointerEvents={scannerOpen ? "none" : "auto"}
        accessibilityElementsHidden={scannerOpen}
        importantForAccessibility={scannerOpen ? "no-hide-descendants" : "auto"}
        className="flex-1"
        contentContainerClassName="items-center"
        contentContainerStyle={{
          paddingHorizontal: SIDE_MARGIN,
          paddingTop: contentTop,
          paddingBottom: insets.bottom + 32,
        }}
        contentInsetAdjustmentBehavior="never"
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={liftStyle} className="w-full items-center">
          <LayoutAnimationConfig skipEntering>
            <View
              className="w-full items-center"
              style={{ gap: HELP_GAP, maxWidth: FORM_MAX_WIDTH }}
              onLayout={reportHero}
            >
              <View
                className="w-full items-center gap-8"
                onLayout={({ nativeEvent: { layout } }) => {
                  setMainHeight(layout.height);
                  if (stage.slots === "options") setAnchorHeight(layout.height);
                }}
              >
                <View
                  ref={hero}
                  collapsable={false}
                  onLayout={reportHero}
                  style={{ width: HERO_SIZE, height: HERO_SIZE }}
                >
                  <Animated.View style={heroStyle}>
                    <AppLogo
                      size={HERO_SIZE}
                      animation={animationActive ? "blink" : "none"}
                      interactive={animationActive}
                    />
                  </Animated.View>
                </View>
                <Animated.View style={titleStyle} className="w-full">
                  <SignInTitle
                    step={stage.labels}
                    texts={{
                      options: [t("mobile.auth.signIn.title"), t("mobile.auth.signIn.subtitle")],
                      email: [t("mobile.auth.email.title"), t("mobile.auth.email.description")],
                      code: [
                        t("mobile.auth.email.codeTitle"),
                        t("mobile.auth.email.codeSent", { email: signIn.challenge?.email ?? signIn.email }),
                      ],
                    }}
                    motion={stepMotion}
                    reduced={reducedMotion}
                  />
                </Animated.View>
                <Animated.View style={actionsStyle}>
                  <SignInControls
                    signIn={signIn}
                    stage={stage}
                    width={formWidth}
                    motion={stepMotion}
                    reduced={reducedMotion}
                    qrButton={button}
                    emailInput={emailInput}
                    codeInput={codeInput}
                    scannerOpen={scannerOpen}
                    onScan={openScanner}
                    onOpenEmail={() => {
                      motion?.finish();
                      signIn.openEmail();
                    }}
                  />
                </Animated.View>
              </View>
              {stage.help ? (
                <Animated.View
                  key="help"
                  entering={stepMotion.fadeIn(120)}
                  exiting={stepMotion.fadeOut}
                  className="w-full"
                >
                  {/* The splash reveal sets opacity, so it stays off the view that the entrance animates. */}
                  <Animated.View style={actionsStyle} className="w-full">
                    <Accordion className="w-full" hideSeparator animation={reducedMotion ? "disable-all" : undefined}>
                      <Accordion.Item value="desktop-qr">
                        <View onLayout={({ nativeEvent: { layout } }) => setHelpTriggerHeight(layout.height)}>
                          <Accordion.Trigger className="min-h-11 justify-center gap-2">
                            <Typography color="muted" className="text-caption">
                              {t("mobile.auth.signIn.helpTitle")}
                            </Typography>
                            <Accordion.Indicator />
                          </Accordion.Trigger>
                        </View>
                        <Accordion.Content>
                          <View className="gap-3 pt-3">
                            <Typography.Paragraph color="muted">
                              {t("mobile.auth.signIn.helpStep1")}
                            </Typography.Paragraph>
                            <Typography.Paragraph color="muted">
                              {t("mobile.auth.signIn.helpStep2")}
                            </Typography.Paragraph>
                            <Typography.Paragraph color="muted">
                              {t("mobile.auth.signIn.helpStep3")}
                            </Typography.Paragraph>
                          </View>
                        </Accordion.Content>
                      </Accordion.Item>
                    </Accordion>
                  </Animated.View>
                </Animated.View>
              ) : null}
            </View>
          </LayoutAnimationConfig>
        </Animated.View>
      </ScrollView>
      {notice ? (
        <Animated.View
          style={[titleStyle, { position: "absolute", top: insets.top + 8, left: 16, right: 16 }]}
          pointerEvents={scannerOpen ? "none" : "box-none"}
          accessibilityElementsHidden={scannerOpen}
          importantForAccessibility={scannerOpen ? "no-hide-descendants" : "auto"}
          onLayout={({ nativeEvent: { layout } }) => setBannerHeight(layout.height)}
        >
          <SignInNoticeBanner notice={notice} disabled={scannerOpen} />
        </Animated.View>
      ) : null}
      {origin && isFocused ? (
        <ScanQrSheet
          origin={origin}
          viewport={viewport}
          onClose={closeScanner}
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
        />
      ) : null}
    </View>
  );
}
