import { requireOptionalNativeModule } from "expo";
import { isIOS } from "@/shared/lib/platform";

const qrCamera = isIOS ? requireOptionalNativeModule<{ preferredLens(): string | null }>("OpenBotQrCamera") : null;

/** Expo Go and older builds keep the default camera when the native selector is absent. */
export function preferredQrScannerLens(): string | undefined {
  try {
    return qrCamera?.preferredLens() ?? undefined;
  } catch {
    return undefined;
  }
}
