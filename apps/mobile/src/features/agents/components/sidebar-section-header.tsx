import type { SidebarLayoutAction } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import { memo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { TeamSectionHeading } from "@/features/agents/components/team-home-parts";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export const SidebarSectionHeader = memo(function SidebarSectionHeader({
  id,
  name,
  empty,
  count,
  hasLead,
  separated,
  visibleSectionIds,
  collapsed,
  onToggle,
}: {
  id: string;
  name: string;
  empty: boolean;
  count: number;
  hasLead: boolean;
  separated: boolean;
  visibleSectionIds: readonly string[];
  collapsed: boolean;
  onToggle: (sectionId: string) => void;
}) {
  const { t } = useText();
  const workspace = useMobileWorkspaceReader();
  const serverId = useMobileWorkspaceSelector(({ activeServer }) => activeServer.id);
  const online = useMobileWorkspaceSelector(({ activeServer }) => showsOnline(activeServer));
  const layout = useMobileWorkspaceSelector(
    ({ activeServer, sidebarByServer }) => sidebarByServer[activeServer.id]?.layout,
  );
  const muted = String(useThemeColor("muted"));
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const custom = layout?.sections.some((section) => section.id === id);
  const index = layout?.order.indexOf(id) ?? -1;
  const visibleIndex = visibleSectionIds.indexOf(id);
  const disabled = !online || saving;
  async function run(action: SidebarLayoutAction) {
    if (pending.current || disabled) return;
    pending.current = true;
    setSaving(true);
    try {
      await workspace().mutateSidebarLayout(serverId, action);
      void (action.type === "move" ? haptics.selection() : haptics.notification("success"));
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        error,
        "agent",
        text.t("mobile.agent.section.changeFailed"),
        text.errorMessage(error, text.t("mobile.agent.section.tryAgain")),
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const actions: MenuAction[] = [
    { id: "up", title: t("mobile.agent.section.moveUp"), attributes: { disabled: disabled || visibleIndex <= 0 } },
    {
      id: "down",
      title: t("mobile.agent.section.moveDown"),
      attributes: { disabled: disabled || visibleIndex >= visibleSectionIds.length - 1 },
    },
    ...(custom
      ? [
          { id: "rename", title: t("common.rename"), attributes: { disabled } },
          { id: "delete", title: t("mobile.agent.section.delete"), attributes: { disabled, destructive: true } },
        ]
      : []),
  ];
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: separated ? 20 : 0, paddingBottom: 0 }}>
      <TeamSectionHeading
        name={name}
        count={count}
        hasLead={hasLead}
        collapsed={collapsed}
        onToggle={() => {
          void haptics.selection();
          onToggle(id);
        }}
        menu={
          <MenuView
            actions={actions}
            onPressAction={({ nativeEvent }) => {
              const action = nativeEvent.event;
              if (action === "up" || action === "down")
                void run({
                  type: "move",
                  sectionId: id,
                  direction: action,
                  steps: Math.abs(
                    index -
                      (layout?.order.indexOf(visibleSectionIds[visibleIndex + (action === "up" ? -1 : 1)] ?? id) ??
                        index),
                  ),
                });
              if (action === "rename") router.push({ pathname: "/section-form", params: { serverId, sectionId: id } });
              if (action === "delete")
                Alert.alert(t("mobile.agent.section.deleteTitle", { name }), t("mobile.agent.section.deleteBody"), [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("common.delete"),
                    style: "destructive",
                    onPress: () => void run({ type: "delete", sectionId: id }),
                  },
                ]);
            }}
          >
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel={t("mobile.agent.section.options", { name })}
              style={{ width: 40, height: 44, alignItems: "flex-end", justifyContent: "center" }}
              hitSlop={8}
            >
              <Ellipsis size={18} color={muted} />
            </View>
          </MenuView>
        }
      />
      {empty && !collapsed ? (
        <Typography.Paragraph className="pb-2 text-muted" style={typeScale.preview}>
          {t("mobile.agent.section.empty")}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
});
