import { Image } from "expo-image";
import { usePathname } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Fingerprint from "lucide-react-native/icons/fingerprint-pattern";
import LockKeyhole from "lucide-react-native/icons/lock-keyhole";
import ScanFace from "lucide-react-native/icons/scan-face";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, BackHandler, Modal, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import logo from "@/assets/splash/mark.png";
import { PinDots, PinPad } from "@/features/app-lock/components/pin-pad";
import {
  cancelOwnerConfirmation,
  forgetAppLockAndSignOut,
  MAX_PIN_FAILURES,
  pinBlockedUntil,
  retryAppLockLoad,
  unlockAfterSignIn,
  unlockWithDevice,
  unlockWithPin,
  useAppLock,
} from "@/features/app-lock/model/app-lock";
import { appLockEnabled, PIN_LENGTH } from "@/features/app-lock/model/app-lock-storage";
import { type DeviceUnlockKind, deviceUnlockKind } from "@/features/app-lock/model/device-unlock";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SplashWallpaper } from "@/shared/components/splash-backdrop";
import { haptics } from "@/shared/lib/haptics";
import { isIOS } from "@/shared/lib/platform";
import { type MobileText, useText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

/** The attempts left are shown when this many or fewer remain. */
const SHOW_ATTEMPTS_LEFT = 5;

export function deviceUnlockName(kind: DeviceUnlockKind | null, t: MobileText["t"]): string {
  if (kind === "faceId") return t("mobile.appLock.method.faceId");
  if (kind === "touchId") return t("mobile.appLock.method.touchId");
  return t("mobile.appLock.method.phone");
}

function DeviceUnlockIcon({ kind, size, color }: { kind: DeviceUnlockKind | null; size: number; color: string }) {
  if (kind === "faceId") return <ScanFace size={size} color={color} strokeWidth={1.75} />;
  if (kind === "touchId") return <Fingerprint size={size} color={color} strokeWidth={1.75} />;
  return <LockKeyhole size={size} color={color} strokeWidth={1.75} />;
}

/**
 * Covers the app while it is locked, and while it is not active so the app switcher shows no chat.
 * iOS draws it in a window layer above the sheets; Android draws it in a dialog window.
 */
export function AppLockOverlay() {
  const { loading, session } = useMobileSession();
  const status = useAppLock((state) => state.status);
  const enabled = useAppLock((state) => appLockEnabled(state.config));
  const locked = useAppLock((state) => state.locked);
  const covered = useAppLock((state) => state.covered);
  const confirming = useAppLock((state) => state.confirming);
  const pathname = usePathname();

  // A new sign-in proves who the user is, so it does not ask for the lock again.
  const signedOut = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!session) {
      signedOut.current = true;
      return;
    }
    if (signedOut.current) {
      signedOut.current = false;
      unlockAfterSignIn();
    }
  }, [loading, session]);

  if (!session) return null;
  const showLock = status === "failed" || (status === "ready" && enabled && locked);
  const showCover = status === "loading" || (enabled && covered);
  if (!showLock && !showCover) return null;

  const content = (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <View className="flex-1 bg-background">
        <SplashWallpaper />
        {showLock ? <LockScreen /> : <Cover />}
      </View>
    </GestureHandlerRootView>
  );

  if (isIOS) {
    // A sheet that opens while the app is locked goes above this layer. A new key adds the layer
    // again, on top of it.
    return <FullWindowOverlay key={showLock ? pathname : "cover"}>{content}</FullWindowOverlay>;
  }
  return (
    <Modal
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (confirming) cancelOwnerConfirmation();
        else BackHandler.exitApp();
      }}
    >
      {content}
    </Modal>
  );
}

function Cover() {
  return (
    <View className="flex-1 items-center justify-center">
      <Image accessible={false} source={logo} style={{ width: 96, height: 96 }} contentFit="contain" />
    </View>
  );
}

function LockScreen() {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const foreground = useThemeColor("foreground");
  const buttonForeground = useThemeColor("default-foreground");
  const { signOut } = useMobileSession();
  const status = useAppLock((state) => state.status);
  const config = useAppLock((state) => state.config);
  const confirming = useAppLock((state) => state.confirming);
  const lockCount = useAppLock((state) => state.lockCount);
  const attempts = useAppLock((state) => state.attempts);
  const appForeground = useAppForeground();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<DeviceUnlockKind | null>(null);
  const [now, setNow] = useState(Date.now);
  const method = deviceUnlockName(kind, t);

  useEffect(() => {
    if (!config.deviceUnlock) return;
    let active = true;
    void deviceUnlockKind().then((next) => {
      if (active) setKind(next);
    });
    return () => {
      active = false;
    };
  }, [config.deviceUnlock]);

  const blockedUntil = pinBlockedUntil(attempts, now);
  // The model enforces the wait. This only updates the text each second.
  useEffect(() => {
    if (blockedUntil === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [blockedUntil]);

  const signOutNow = useCallback(
    async (afterTooManyAttempts: boolean) => {
      setBusy(true);
      try {
        await forgetAppLockAndSignOut(signOut);
        if (afterTooManyAttempts) Alert.alert(t("mobile.appLock.lock.signedOut"));
      } catch {
        setMessage(t("mobile.auth.error.signOutUnconfirmed"));
        void haptics.notification("error");
      } finally {
        setBusy(false);
      }
    },
    [signOut, t],
  );

  const confirmSignOut = () =>
    Alert.alert(t("mobile.appLock.lock.signOutTitle"), t("mobile.appLock.lock.signOutBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("mobile.appLock.lock.signOut"), style: "destructive", onPress: () => void signOutNow(false) },
    ]);

  const promptDevice = useCallback(async () => {
    setMessage(null);
    const result = await unlockWithDevice(t("mobile.appLock.lock.unlockPrompt"), t("common.cancel"));
    if (result === "unavailable") setMessage(t("mobile.appLock.device.unavailable"));
    else if (result === "failed") setMessage(t("mobile.appLock.device.failed", { method }));
  }, [method, t]);

  // Offer Face ID once for each lock, when the app is in the foreground.
  const prompted = useRef(-1);
  useEffect(() => {
    if (!appForeground || status !== "ready" || !config.deviceUnlock || prompted.current === lockCount) return;
    prompted.current = lockCount;
    void promptDevice();
  }, [appForeground, config.deviceUnlock, lockCount, promptDevice, status]);

  async function submit(value: string) {
    setBusy(true);
    try {
      const result = await unlockWithPin(value);
      setPin("");
      if (result === "unlocked") {
        void haptics.notification("success");
        return;
      }
      void haptics.notification("error");
      if (result === "wrong") {
        const left = MAX_PIN_FAILURES - useAppLock.getState().attempts.failures;
        setMessage(
          left <= SHOW_ATTEMPTS_LEFT
            ? t("mobile.appLock.lock.attemptsLeft", { count: left })
            : t("mobile.appLock.lock.wrongPin"),
        );
      } else if (result === "tooManyAttempts") {
        await signOutNow(true);
      } else if (result === "unavailable") {
        setMessage(t("mobile.appLock.lock.pinMissing"));
      } else if (result === "failed") {
        setMessage(t("mobile.appLock.lock.checkFailed"));
      } else {
        setMessage(null);
      }
    } finally {
      setBusy(false);
    }
  }

  function addDigit(digit: string) {
    if (busy || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(next);
  }

  let waitText: string | null = null;
  if (blockedUntil !== null) {
    const seconds = Math.ceil((blockedUntil - now) / 1000);
    waitText =
      seconds > 90
        ? t("mobile.appLock.lock.waitMinutes", { count: Math.ceil(seconds / 60) })
        : t("mobile.appLock.lock.waitSeconds", { count: seconds });
  }

  if (status === "failed") {
    return (
      <LockLayout
        insets={insets}
        title={t("mobile.appLock.lock.title")}
        message={t("mobile.appLock.lock.loadFailed")}
        footer={
          <Button variant="ghost" size="sm" isDisabled={busy} onPress={confirmSignOut}>
            <Button.Label>{t("mobile.appLock.lock.signOut")}</Button.Label>
          </Button>
        }
      >
        <Button
          variant="tertiary"
          className="rounded-full px-8"
          isDisabled={busy}
          onPress={() => void retryAppLockLoad()}
        >
          <Button.Label>{t("mobile.appLock.lock.retry")}</Button.Label>
        </Button>
      </LockLayout>
    );
  }

  const deviceKey = config.deviceUnlock ? (
    <Button
      variant="ghost"
      isIconOnly
      isDisabled={busy}
      accessibilityLabel={t("mobile.appLock.lock.useDevice", { method })}
      className="size-20 rounded-full"
      onPress={() => void promptDevice()}
    >
      <DeviceUnlockIcon kind={kind} size={30} color={foreground} />
    </Button>
  ) : null;

  const footer = confirming ? (
    <Button variant="ghost" size="sm" isDisabled={busy} onPress={cancelOwnerConfirmation}>
      <Button.Label>{t("common.cancel")}</Button.Label>
    </Button>
  ) : (
    <Button variant="ghost" size="sm" isDisabled={busy} onPress={confirmSignOut}>
      <Button.Label>{config.pin ? t("mobile.appLock.lock.forgotPin") : t("mobile.appLock.lock.signOut")}</Button.Label>
    </Button>
  );

  return (
    <LockLayout
      insets={insets}
      title={confirming ? t("mobile.appLock.lock.confirmTitle") : t("mobile.appLock.lock.title")}
      message={waitText ?? message ?? (config.pin ? t("mobile.appLock.lock.enterPin") : null)}
      error={waitText !== null || message !== null}
      pad={
        config.pin ? (
          <PinPad
            disabled={busy || blockedUntil !== null}
            canDelete={pin.length > 0}
            leading={deviceKey}
            onDigit={addDigit}
            onDelete={() => setPin((current) => current.slice(0, -1))}
          />
        ) : null
      }
      footer={footer}
    >
      {config.pin ? (
        <PinDots count={pin.length} />
      ) : (
        <Button
          variant="tertiary"
          className="rounded-full px-6"
          isDisabled={busy}
          accessibilityLabel={t("mobile.appLock.lock.useDevice", { method })}
          onPress={() => void promptDevice()}
        >
          <DeviceUnlockIcon kind={kind} size={20} color={buttonForeground} />
          <Button.Label>{t("mobile.appLock.lock.unlock")}</Button.Label>
        </Button>
      )}
    </LockLayout>
  );
}

/**
 * The logo, title, message and main control sit in the middle of the space above the number pad. The
 * number pad, when there is one, sits low where the thumb reaches it.
 */
function LockLayout({
  insets,
  title,
  message,
  error = false,
  pad = null,
  footer,
  children,
}: {
  insets: { top: number; bottom: number };
  title: string;
  message: string | null;
  error?: boolean;
  pad?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <View className="flex-1 items-center" style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 8 }}>
      <View className="flex-1 items-center justify-center gap-8 self-stretch px-8">
        <View className="items-center gap-3">
          <Image accessible={false} source={logo} style={{ width: 72, height: 72 }} contentFit="contain" />
          <Typography.Heading type="h3" align="center" accessibilityRole="header" className="mt-3">
            {title}
          </Typography.Heading>
          <View className="min-h-10">
            {message ? (
              <Typography.Paragraph
                align="center"
                accessibilityLiveRegion="polite"
                className={error ? "text-danger-text" : "text-text-secondary"}
              >
                {message}
              </Typography.Paragraph>
            ) : null}
          </View>
        </View>
        {children}
      </View>
      {pad}
      <View className="mt-4 min-h-10 justify-center">{footer}</View>
    </View>
  );
}
