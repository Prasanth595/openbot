import type { AppInfo } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
/**
 * Whether this build can transcribe at all. The voice runtime is prepared for macOS and Windows
 * only, so the Linux package ships without one and the composer offers no microphone rather than a
 * control that always fails.
 */
export function voiceSupported(platform: AppInfo["platform"] | undefined): boolean {
  return platform !== "linux";
}

export function voiceCaptureError(error: unknown) {
  const { t } = currentText();
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return t("composer.voice.blocked");
  }
  if (error instanceof DOMException && error.name === "NotFoundError") return t("composer.voice.noMicrophone");
  return t("composer.voice.startFailed");
}

export function voiceTranscriptionError(error: unknown): string {
  const { t, errorMessage } = currentText();
  return errorMessage(error, t("composer.voice.transcribeFailed"));
}
