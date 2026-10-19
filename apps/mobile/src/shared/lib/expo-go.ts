import { isAndroid } from "@/shared/lib/platform";

/** Expo Go on Android. The constants load only on Android, so iOS and tests do not load them here. */
export function expoGoOnAndroid(): boolean {
  if (!isAndroid) return false;
  const constants: typeof import("expo-constants") = require("expo-constants");
  return constants.default.executionEnvironment === constants.ExecutionEnvironment.StoreClient;
}
