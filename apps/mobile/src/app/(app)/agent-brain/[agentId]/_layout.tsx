import { Stack } from "expo-router";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";

export default function AgentBrainStack() {
  const background = String(useCSSVariable("--openbot-bg-sheet"));
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
