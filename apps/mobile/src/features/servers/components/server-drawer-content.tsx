import { type MenuAction, type MenuComponentRef, MenuView } from "@expo/ui/community/menu";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import type { Href } from "expo-router";
import { Typography } from "heroui-native";
import { Check, Plus, Settings } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { useUniwind } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import type { MobileSession } from "@/features/auth/api/mobile-auth";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import {
  refreshHostedServerAvailability,
  useHostedServerAvailability,
} from "@/features/servers/model/hosted-server-availability";
import type { MobileServer } from "@/features/workspace/context/mobile-workspace-context";
import { moveServerId } from "@/features/workspace/model/server-order";
import { serverStatusLabel } from "@/features/workspace/model/server-status";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { devFeatureOverride } from "@/shared/lib/dev-feature-overrides";
import { haptics } from "@/shared/lib/haptics";
import { refreshMobileFeatures, useMobileFeature } from "@/shared/lib/mobile-features";
import { isAndroid } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { ServerAvatar } from "./server-avatar";
import { ServerDrawerIconButton } from "./server-drawer-icon-button";
import { SERVER_ROW_HEIGHT, SortableServerList } from "./sortable-server-list";

interface ServerDrawerContentProps {
  activeServerId: string;
  headerHeight: number;
  listTopInset: number;
  muted: ViewStyle["backgroundColor"];
  open: boolean;
  defaultServerId: string | null;
  servers: MobileServer[];
  session: MobileSession;
  sideInset: number;
  topInset: number;
  onNavigate: (href: Href) => void;
  onSetDefault: (serverId: string | null) => boolean;
  onLeave: (serverId: string) => Promise<void>;
  onRemove: (serverId: string) => Promise<void>;
  onReorder: (serverIds: string[]) => boolean;
  onSelectServer: (serverId: string) => void;
}

/** Local or Remote, with the connection state only when it needs attention. The dot shows online or offline. */
function serverDetail(server: MobileServer, t: MobileTranslate): string {
  const label = serverKindLabel(server, t);
  const pending = server.state === "connecting" && server.initialConnectionPending;
  return pending || server.state === "error" ? `${label} · ${serverStatusLabel(server, t)}` : label;
}

function ignoreLongPress(): void {}

type ServerExit = "leave" | "remove";

function serverKindLabel(server: MobileServer, t: MobileTranslate): string {
  return server.kind === "local" ? t("mobile.server.drawer.local") : t("mobile.server.drawer.remote");
}

export function ServerDrawerContent({
  activeServerId,
  headerHeight,
  listTopInset,
  muted,
  open,
  defaultServerId,
  servers,
  session,
  sideInset,
  topInset,
  onNavigate,
  onSetDefault,
  onLeave,
  onRemove,
  onReorder,
  onSelectServer,
}: ServerDrawerContentProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  // Android: the row's own long press opens its menu, as on the agent rows. `shouldOpenOnLongPress`
  // does not open it there, because the row takes the long press.
  const menus = useRef(new Map<string, MenuComponentRef | null>());
  const displayName = mobileUserName(session.user);
  const avatarUrl = session.user.avatarUrl ? new URL(session.user.avatarUrl, session.apiUrl).toString() : null;
  const mutedColor = String(muted);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The iOS menu host sizes to its content, so a row in a menu gets the slot width explicitly.
  const [rowWidth, setRowWidth] = useState<number>();
  // The one default server stays above the divider. The app opens on the first server of the list.
  const defaultServers = servers.filter((server) => server.id === defaultServerId);
  const listedServers = servers.filter((server) => server.id !== defaultServerId);
  const listedIds = listedServers.map((server) => server.id);
  const canReorder = listedIds.length > 1;
  const hostedServerIds = useHostedServerAvailability((state) =>
    state.userId === session.user.id ? state.serverIds : null,
  );
  const exiting = useRef(false);
  // The same rules as the server settings screen. The owner cannot leave. Billing deletes a hosted
  // server, so Remove shows only after the hosted servers are known.
  function serverExit(server: MobileServer): ServerExit | null {
    if (server.role !== "owner") return "leave";
    return hostedServerIds && !hostedServerIds.has(server.id) ? "remove" : null;
  }
  function menuActions(server: MobileServer): MenuAction[] {
    const serverId = server.id;
    const listActions: MenuAction[] = [
      serverId === defaultServerId
        ? { id: "removeDefault", title: t("mobile.server.drawer.removeDefault"), image: "star.slash" }
        : { id: "makeDefault", title: t("mobile.server.drawer.makeDefault"), image: "star" },
    ];
    if (canReorder)
      listActions.push({ id: "reorder", title: t("mobile.server.drawer.editOrder"), image: "arrow.up.arrow.down" });
    const actions: MenuAction[] = [
      { id: "options", title: t("mobile.server.drawer.options"), image: "gearshape" },
      { id: "routines", title: t("mobile.server.drawer.routines"), image: "calendar" },
      { id: "usage", title: t("mobile.server.drawer.usage"), image: "chart.bar" },
      // The inline section draws a divider above the actions that change the list.
      { id: "list", title: "", displayInline: true, subactions: listActions },
    ];
    const exit = serverExit(server);
    if (exit)
      actions.push({
        id: "exit",
        title: "",
        displayInline: true,
        subactions: [
          {
            id: exit,
            title: exit === "leave" ? t("mobile.server.settings.leave") : t("mobile.server.settings.remove"),
            image: exit === "leave" ? "rectangle.portrait.and.arrow.right" : "trash",
            attributes: { destructive: true },
          },
        ],
      });
    return actions;
  }

  // The server leaves the list after it succeeds, and the workspace selects another server if it was active.
  function confirmExit(server: MobileServer, exit: ServerExit) {
    const leave = exit === "leave";
    Alert.alert(
      leave
        ? t("mobile.server.settings.leaveTitle", { name: server.name })
        : t("mobile.server.settings.removeTitle", { name: server.name }),
      leave ? t("mobile.server.settings.leaveBody") : t("mobile.server.settings.removeBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: leave ? t("mobile.server.settings.leave") : t("mobile.server.settings.remove"),
          style: "destructive",
          onPress: () => void exitServer(server, exit),
        },
      ],
    );
  }

  async function exitServer(server: MobileServer, exit: ServerExit) {
    if (exiting.current) return;
    exiting.current = true;
    try {
      await (exit === "leave" ? onLeave : onRemove)(server.id);
      void haptics.notification("success");
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      // The account service explains a refusal, such as a hosted server that Billing deletes.
      showFailureAlert(
        error,
        "team",
        exit === "leave"
          ? text.t("mobile.server.drawer.leaveFailed", { name: server.name })
          : text.t("mobile.server.drawer.removeFailed", { name: server.name }),
        text.errorMessage(error, text.t("mobile.server.drawer.actionFailed")),
      );
    } finally {
      exiting.current = false;
    }
  }

  // A drag cut short by leaving edit mode never reports its end, so leaving also releases the scroll lock.
  const stopEditing = () => {
    void haptics.selection();
    setEditing(false);
    setDragging(false);
  };

  useEffect(() => {
    if (open) return;
    setEditing(false);
    setDragging(false);
  }, [open]);

  // The plus button opens the plans and the account's hosted servers when the account can have
  // hosted servers and the feature flag of this build is on. A development build can override both.
  const accountHasPlans = useHostedServerAvailability((state) => state.userId === session.user.id && state.available);
  const cloudServersOn = useMobileFeature(session.apiUrl, "cloudServers");
  const showsPlans = devFeatureOverride("cloudServers") ?? (accountHasPlans && cloudServersOn);
  useEffect(() => {
    if (!open) return;
    void refreshHostedServerAvailability(session.user.id, hostedServerCalls(session));
    void refreshMobileFeatures(session.apiUrl);
  }, [open, session]);

  function move(serverId: string, targetIndex: number) {
    const next = moveServerId(listedIds, serverId, targetIndex);
    if (next.join("\n") !== listedIds.join("\n")) onReorder(next);
  }

  const toggleDefault = (serverId: string) => {
    if (onSetDefault(serverId === defaultServerId ? null : serverId)) void haptics.selection();
  };

  const openOptions = (serverId: string) => onNavigate({ pathname: "/server-settings", params: { serverId } });
  const openRoutines = (serverId: string) => onNavigate({ pathname: "/server-routines", params: { serverId } });
  const openUsage = (serverId: string) => onNavigate({ pathname: "/server-usage", params: { serverId } });

  function renderRow(serverItem: MobileServer, width?: number) {
    const selected = serverItem.id === activeServerId;
    const listIndex = listedIds.indexOf(serverItem.id);
    const serverLabel = serverKindLabel(serverItem, t);
    const exit = serverExit(serverItem);
    const accessibilityActions = [
      ...(editing
        ? []
        : [
            { name: "options", label: t("mobile.server.drawer.serverOptions") },
            { name: "routines", label: t("mobile.server.drawer.routines") },
            { name: "usage", label: t("mobile.server.drawer.usage") },
            serverItem.id === defaultServerId
              ? { name: "removeDefault", label: t("mobile.server.drawer.removeDefault") }
              : { name: "makeDefault", label: t("mobile.server.drawer.makeDefault") },
            ...(exit === "leave" ? [{ name: "leave", label: t("mobile.server.settings.leave") }] : []),
            ...(exit === "remove" ? [{ name: "remove", label: t("mobile.server.settings.remove") }] : []),
          ]),
      ...(listIndex > 0 ? [{ name: "moveUp", label: t("mobile.server.drawer.moveUp") }] : []),
      ...(listIndex >= 0 && listIndex < listedIds.length - 1
        ? [{ name: "moveDown", label: t("mobile.server.drawer.moveDown") }]
        : []),
    ];
    return (
      <Pressable
        key={serverItem.id}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${serverItem.name}, ${serverLabel}, ${serverStatusLabel(serverItem, t)}`}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={(event) => {
          const action = event.nativeEvent.actionName;
          if (action === "options") openOptions(serverItem.id);
          if (action === "routines") openRoutines(serverItem.id);
          if (action === "usage") openUsage(serverItem.id);
          if (action === "makeDefault" || action === "removeDefault") toggleDefault(serverItem.id);
          if (action === "leave" || action === "remove") confirmExit(serverItem, action);
          if (action === "moveUp") move(serverItem.id, listIndex - 1);
          if (action === "moveDown") move(serverItem.id, listIndex + 1);
        }}
        className={`flex-row items-center gap-3 rounded-2xl px-2.5 ${selected ? "bg-control" : ""}`}
        onPress={editing ? undefined : () => onSelectServer(serverItem.id)}
        // The native context menu does not cancel this touch. Without a long-press handler, lifting the
        // finger after the menu opens counts as a tap and closes the drawer under the open menu.
        onLongPress={editing ? undefined : isAndroid ? () => menus.current.get(serverItem.id)?.show() : ignoreLongPress}
        style={({ pressed }) => ({ height: SERVER_ROW_HEIGHT - 8, opacity: pressed ? 0.58 : 1, width })}
      >
        <ServerAvatar server={serverItem} />
        <View className="min-w-0 flex-1">
          <Typography.Paragraph
            weight="medium"
            className={serverItem.state === "online" ? undefined : "text-text-secondary"}
            numberOfLines={1}
          >
            {serverItem.name}
          </Typography.Paragraph>
          <Typography.Paragraph
            type="body-xs"
            className={serverItem.state === "error" ? "text-danger-text" : "text-text-secondary"}
            numberOfLines={1}
          >
            {serverDetail(serverItem, t)}
          </Typography.Paragraph>
        </View>
      </Pressable>
    );
  }

  // Every row gets the same fixed slot, so the list keeps its spacing in edit mode and in the menu wrapper.
  function rowSlot(serverItem: MobileServer, row: ReactNode) {
    return (
      <View
        key={serverItem.id}
        className="justify-center"
        style={{ height: SERVER_ROW_HEIGHT }}
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
      >
        {row}
      </View>
    );
  }

  function withMenu(serverItem: MobileServer) {
    return rowSlot(
      serverItem,
      <MenuView
        {...(isAndroid
          ? {
              ref: (menu: MenuComponentRef | null) => {
                menus.current.set(serverItem.id, menu);
              },
              colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const),
            }
          : null)}
        shouldOpenOnLongPress
        actions={menuActions(serverItem)}
        onPressAction={(event) => {
          if (event.nativeEvent.event === "options") openOptions(serverItem.id);
          if (event.nativeEvent.event === "routines") openRoutines(serverItem.id);
          if (event.nativeEvent.event === "usage") openUsage(serverItem.id);
          if (event.nativeEvent.event === "makeDefault" || event.nativeEvent.event === "removeDefault")
            toggleDefault(serverItem.id);
          if (event.nativeEvent.event === "reorder") setEditing(true);
          if (event.nativeEvent.event === "leave" || event.nativeEvent.event === "remove")
            confirmExit(serverItem, event.nativeEvent.event);
        }}
      >
        {renderRow(serverItem, rowWidth)}
      </MenuView>,
    );
  }

  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerClassName="pr-3"
        contentContainerStyle={{ paddingTop: listTopInset }}
        contentInsetAdjustmentBehavior="never"
        scrollEnabled={!dragging}
        showsVerticalScrollIndicator={false}
      >
        {defaultServers.map((serverItem) =>
          editing ? rowSlot(serverItem, renderRow(serverItem)) : withMenu(serverItem),
        )}
        {defaultServers.length && listedIds.length ? (
          <View accessibilityElementsHidden className="mx-2.5 my-4 h-px bg-grouped-border" />
        ) : null}
        {editing ? (
          <SortableServerList
            color={mutedColor}
            ids={listedIds}
            renderRow={(id) => {
              const serverItem = servers.find((candidate) => candidate.id === id);
              return serverItem ? renderRow(serverItem) : null;
            }}
            onDragActive={setDragging}
            onReorder={onReorder}
          />
        ) : (
          listedServers.map(withMenu)
        )}
        {editing ? (
          <Typography.Paragraph type="body-xs" className="px-3 pt-3 text-text-secondary">
            {t("mobile.server.drawer.orderHint")}
          </Typography.Paragraph>
        ) : null}
      </ScrollView>

      <SheetScrollEdgeEffect
        style={{ height: headerHeight + 20, left: -sideInset, position: "absolute", right: -34, top: 0, zIndex: 10 }}
      />

      <View
        className="absolute right-0 z-20 h-14 flex-row items-center justify-between pr-3"
        pointerEvents="box-none"
        style={{ left: -sideInset, paddingLeft: sideInset + 12, top: Math.max(topInset, 16) }}
      >
        <Typography.Heading type="h1" weight="bold">
          {t("mobile.server.drawer.title")}
        </Typography.Heading>
        {editing ? (
          <ServerDrawerIconButton
            accessibilityLabel={t("mobile.server.drawer.doneEditing")}
            color={mutedColor}
            fallbackVariant="filled"
            systemName="checkmark"
            onPress={stopEditing}
          >
            <Check color={mutedColor} size={18} strokeWidth={2} />
          </ServerDrawerIconButton>
        ) : (
          <ServerDrawerIconButton
            accessibilityLabel={showsPlans ? t("mobile.server.drawer.add") : t("mobile.server.drawer.join")}
            color={mutedColor}
            fallbackVariant="filled"
            systemName="plus"
            onPress={() => onNavigate(showsPlans ? "/hosted-server" : "/add-server")}
          >
            <Plus color={mutedColor} size={18} strokeWidth={2} />
          </ServerDrawerIconButton>
        )}
      </View>

      <View className="mr-3 flex-row items-center gap-2 pt-2">
        <View className="min-h-14 min-w-0 flex-1 flex-row items-center gap-2.5 rounded-2xl px-2 py-2">
          <ProfileAvatar neutral name={displayName} imageUrl={avatarUrl} size={36} />
          <View className="min-w-0 flex-1">
            <Typography.Paragraph type="body-sm" weight="semibold" numberOfLines={1}>
              {displayName}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1} selectable>
              {session.user.email}
            </Typography.Paragraph>
          </View>
        </View>
        <ServerDrawerIconButton
          accessibilityLabel={t("mobile.server.drawer.settings")}
          color={mutedColor}
          systemName="gearshape"
          onPress={() => onNavigate("/settings")}
        >
          <Settings color={mutedColor} size={18} strokeWidth={1.8} />
        </ServerDrawerIconButton>
      </View>
    </>
  );
}
