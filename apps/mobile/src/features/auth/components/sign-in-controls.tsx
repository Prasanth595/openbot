import { ONE_TIME_CODE_LENGTH } from "@openbot/contracts/validation";
import { Spinner, Typography } from "heroui-native";
import type { Ref } from "react";
import { type TextInput, View } from "react-native";
import Animated from "react-native-reanimated";

import { EmailCodeInput, type EmailCodeInputHandle } from "@/features/auth/components/email-code-input";
import { EmailField } from "@/features/auth/components/email-field";
import { SignInChoiceButton } from "@/features/auth/components/sign-in-choices";
import { SIGN_IN_CONTROL_HEIGHT, useSignInColors } from "@/features/auth/components/sign-in-colors";
import type { SignInMotion } from "@/features/auth/components/sign-in-motion";
import { type EmailSignIn, formatTimer } from "@/features/auth/model/use-email-sign-in";
import type { SignInStage } from "@/features/auth/model/use-sign-in-choreography";
import { useText } from "@/shared/lib/text";

const GAP = 12;
const MESSAGE_TOP = SIGN_IN_CONTROL_HEIGHT + 8;
const MESSAGE_HEIGHT = 20;
// Options: the two buttons at the top. Form: the field slot and its message line take the top, and
// both buttons move down by the same distance, so they never cross.
const FORM_OFFSET = MESSAGE_TOP + MESSAGE_HEIGHT + GAP;
const SLOTS = {
  options: { primary: 0, secondary: SIGN_IN_CONTROL_HEIGHT + GAP, height: 2 * SIGN_IN_CONTROL_HEIGHT + GAP },
  form: {
    primary: FORM_OFFSET,
    secondary: FORM_OFFSET + SIGN_IN_CONTROL_HEIGHT + GAP,
    height: FORM_OFFSET + 2 * SIGN_IN_CONTROL_HEIGHT + GAP,
  },
} as const;

/**
 * The sign-in controls: one top slot (the email field or the code), one message line, and the two
 * buttons. The stage, not the step, decides what shows, so each change plays in its phase.
 */
export function SignInControls({
  signIn,
  stage,
  width,
  motion,
  reduced,
  qrButton,
  emailInput,
  codeInput,
  scannerOpen,
  onScan,
  onOpenEmail,
}: {
  signIn: EmailSignIn;
  stage: SignInStage;
  width: number;
  motion: SignInMotion;
  reduced: boolean;
  qrButton: Ref<View>;
  emailInput: Ref<TextInput>;
  codeInput: Ref<EmailCodeInputHandle>;
  scannerOpen: boolean;
  onScan: () => void;
  onOpenEmail: () => void;
}) {
  const { t } = useText();
  const colors = useSignInColors();
  const slots = SLOTS[stage.slots];

  const { retryIn, resendIn, deliveryUnconfirmed, sending, resending, needsNewCode } = signIn;
  // A failure that is not about the code itself, such as no network, keeps the code for a retry.
  const canRetry = Boolean(
    signIn.codeIssue && !signIn.codeRejected && !needsNewCode && signIn.code.length === ONE_TIME_CODE_LENGTH,
  );
  const resendLabel = resending
    ? t("mobile.auth.email.resending")
    : resendIn > 0
      ? t("mobile.auth.email.resendIn", { time: formatTimer(resendIn) })
      : needsNewCode
        ? t("mobile.auth.email.sendNewCode")
        : t("mobile.auth.email.resend");
  // The lavender button is the main action of each step; the gray one is the other choice.
  const primary =
    stage.labels === "options"
      ? { label: t("mobile.auth.scanQrCode"), key: "scan", onPress: onScan }
      : stage.labels === "email"
        ? {
            label: sending
              ? t("mobile.auth.email.sending")
              : deliveryUnconfirmed
                ? retryIn > 0
                  ? t("mobile.auth.email.checkAgainIn", { time: formatTimer(retryIn) })
                  : t("mobile.auth.email.checkDelivery")
                : retryIn > 0
                  ? t("mobile.auth.email.tryAgainIn", { time: formatTimer(retryIn) })
                  : t("mobile.auth.email.send"),
            key: sending ? "sending" : retryIn > 0 ? "wait" : deliveryUnconfirmed ? "check" : "send",
            onPress: signIn.sendCode,
            busy: sending,
            waiting: retryIn > 0,
          }
        : canRetry
          ? { label: t("common.retry"), key: "retry", onPress: signIn.retryVerify }
          : {
              label: resendLabel,
              key: resending ? "resending" : resendIn > 0 ? "resend-wait" : "resend",
              onPress: signIn.resendCode,
              busy: resending,
              waiting: resendIn > 0 || signIn.busy,
            };
  const secondary =
    stage.labels === "options"
      ? { label: t("mobile.auth.signIn.emailButton"), onPress: onOpenEmail }
      : stage.labels === "email"
        ? { label: t("mobile.auth.email.useQrCode"), onPress: signIn.back }
        : { label: t("mobile.auth.email.changeEmail"), onPress: signIn.back };

  const message =
    stage.top === "field"
      ? signIn.emailIssue
        ? { key: `email-${signIn.rejection}`, text: signIn.emailIssue.message, color: colors.danger }
        : null
      : stage.top === "code"
        ? signIn.verified
          ? { key: "verified", text: t("mobile.auth.email.verified"), color: colors.success }
          : signIn.verifying
            ? { key: "verifying", text: t("mobile.auth.email.verifying"), color: colors.muted }
            : signIn.codeIssue
              ? { key: `code-${signIn.rejection}`, text: signIn.codeIssue.message, color: colors.danger }
              : signIn.notice
                ? { key: "notice", text: signIn.notice, color: colors.muted }
                : signIn.challenge?.developmentCode
                  ? {
                      key: "development",
                      text: t("mobile.auth.email.developmentCode", { code: signIn.challenge.developmentCode }),
                      color: colors.muted,
                    }
                  : null
        : null;

  return (
    <View style={{ width, height: slots.height }}>
      <View className="absolute inset-x-0 top-0" style={{ height: SIGN_IN_CONTROL_HEIGHT }}>
        <EmailField
          ref={emailInput}
          value={signIn.email}
          onChangeText={signIn.setEmail}
          onSubmit={signIn.sendCode}
          placeholder={t("mobile.auth.email.placeholder")}
          label={t("mobile.auth.email.label")}
          invalid={signIn.emailIssue?.code === "invalid_email"}
          rejection={signIn.rejection}
          editable={!sending}
          visible={stage.top === "field"}
          reduced={reduced}
        />
        {stage.top === "code" ? (
          <Animated.View exiting={motion.fadeOut} className="absolute inset-0">
            <EmailCodeInput
              ref={codeInput}
              value={signIn.code}
              onChange={signIn.setCode}
              onComplete={signIn.verify}
              status={
                signIn.verified ? "verified" : signIn.verifying ? "verifying" : signIn.codeRejected ? "invalid" : "idle"
              }
              rejection={signIn.rejection}
              disabled={needsNewCode || signIn.verified}
              accessibilityLabel={t("mobile.auth.email.codeLabel")}
              motion={motion}
              reduced={reduced}
            />
          </Animated.View>
        ) : null}
      </View>
      <View
        className="absolute inset-x-0 items-center justify-center"
        style={{ top: MESSAGE_TOP, height: MESSAGE_HEIGHT }}
      >
        {message ? (
          <Animated.View
            key={message.key}
            entering={motion.fadeIn()}
            exiting={motion.fadeOut}
            className="flex-row items-center gap-2"
          >
            {signIn.verifying ? <Spinner size="sm" color={colors.muted} /> : null}
            <Typography.Paragraph
              type="body-sm"
              align="center"
              numberOfLines={1}
              accessibilityRole="alert"
              style={{ color: message.color }}
            >
              {message.text}
            </Typography.Paragraph>
          </Animated.View>
        ) : null}
      </View>
      <SignInChoiceButton
        ref={qrButton}
        top={slots.primary}
        brand
        label={primary.label}
        labelKey={`${stage.labels}-${primary.key}`}
        onPress={primary.onPress}
        busy={"busy" in primary ? primary.busy : false}
        waiting={"waiting" in primary ? primary.waiting : false}
        hidden={scannerOpen}
        reduced={reduced}
      />
      <SignInChoiceButton
        top={slots.secondary}
        brand={false}
        label={secondary.label}
        labelKey={stage.labels}
        onPress={secondary.onPress}
        waiting={stage.labels !== "options" && (sending || signIn.verifying || signIn.verified)}
        reduced={reduced}
      />
    </View>
  );
}
