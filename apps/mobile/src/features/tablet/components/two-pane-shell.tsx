import type { PropsWithChildren } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import { ConnectedScreen } from "@/features/agents/screens/connected-screen";
import { useOnboardingGate } from "@/features/onboarding/context/onboarding-gate-context";
import { useTwoPane } from "@/features/tablet/context/two-pane-context";
import { sidebarWidth } from "@/features/tablet/model/two-pane-layout";

/**
 * The tablet layout: the chat list stays on the left and the stack of chats fills the right. The
 * stack keeps every route it has on a phone, so a chat, a task, a browser and every sheet open as
 * they do there; only the window they open in changes.
 *
 * The first-run flow is the exception. It is one guided screen for the whole window, so until it
 * finishes the list keeps no pane and the home route draws the flow itself.
 *
 * The row and the right side are always here, also on a phone. An iPad window that crosses the
 * two-pane width, which Split View and Slide Over do, must only add or remove the list: moving the
 * stack to another parent would unmount it and lose the chat that is open.
 */
export function TwoPaneShell({ children }: PropsWithChildren) {
  const twoPane = useTwoPane();
  const { active: onboarding } = useOnboardingGate();
  const { width } = useWindowDimensions();

  return (
    <View className="flex-1 flex-row">
      {twoPane && !onboarding ? (
        <View
          className="border-separator bg-background"
          style={{ borderRightWidth: StyleSheet.hairlineWidth, width: sidebarWidth(width) }}
        >
          <ConnectedScreen pane />
        </View>
      ) : null}
      <View className="flex-1">{children}</View>
    </View>
  );
}
