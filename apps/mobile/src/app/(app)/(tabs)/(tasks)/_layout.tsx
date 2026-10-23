import { Stack } from "expo-router";
import { useCSSVariable } from "uniwind";
import { isIOS } from "@/shared/lib/platform";

export const unstable_settings = { initialRouteName: "server-tasks" };

export default function TasksStack() {
  const background = String(useCSSVariable("--openbot-bg-canvas"));
  return (
    <Stack
      screenOptions={{
        headerTransparent: isIOS,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: background },
      }}
    >
      <Stack.Screen name="server-tasks" />
      <Stack.Screen name="task/[taskId]" options={{ headerShown: false, fullScreenGestureEnabled: false }} />
    </Stack>
  );
}
