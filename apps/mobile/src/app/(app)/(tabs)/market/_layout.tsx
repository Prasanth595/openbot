import { Stack } from "expo-router";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";

export const unstable_settings = { initialRouteName: "index" };

export default function TabStack() {
  const background = String(useCSSVariable("--openbot-bg-canvas"));
  return (
    <Stack
      screenOptions={{
        headerTransparent: isIOS,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: background },
      }}
    />
  );
}
