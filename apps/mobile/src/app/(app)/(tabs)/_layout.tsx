import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useContext } from "react";
import { useCSSVariable } from "uniwind";
import { ChatNavigationGateContext } from "@/features/agents/components/chat-link-pressable";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "connected" };

export default function TeamTabsLayout() {
  const { t } = useText();
  const gate = useContext(ChatNavigationGateContext);
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const hasServer = useMobileWorkspaceSelector((state) =>
    state.servers.some((server) => server.id === state.activeServer.id),
  );
  return (
    <NativeTabs
      tintColor={accent}
      screenListeners={({ route }) =>
        route.name === "connected" ? { focus: () => gate?.focus(), blur: () => gate?.blur() } : {}
      }
    >
      <NativeTabs.Trigger name="connected">
        <NativeTabs.Trigger.Icon sf={{ default: "person.2", selected: "person.2.fill" }} md="group" />
        <NativeTabs.Trigger.Label>{t("mobile.agent.team.tabTeam")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(tasks)" disabled={!hasServer}>
        <NativeTabs.Trigger.Icon sf="checklist" md="checklist" />
        <NativeTabs.Trigger.Label>{t("mobile.agent.team.tabTasks")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="server-routines" disabled={!hasServer}>
        <NativeTabs.Trigger.Icon sf="calendar.badge.clock" md="event_repeat" />
        <NativeTabs.Trigger.Label>{t("mobile.agent.team.tabRoutines")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="market">
        <NativeTabs.Trigger.Icon sf="storefront" md="storefront" />
        <NativeTabs.Trigger.Label>{t("mobile.agent.team.tabMarket")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} md="settings" />
        <NativeTabs.Trigger.Label>{t("mobile.agent.team.tabSettings")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
