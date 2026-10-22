import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { plainTaskTitle } from "@openbot/team-client/agent-tasks";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Spinner, Typography } from "heroui-native";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import { useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Pressable, TextInput, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { TeamAgentAvatar } from "@/features/agents/components/team-agent-avatar";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useAgentAccessLevel } from "@/features/servers/model/use-server-roles";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The inline task form uses the same host operation and draft guard as the new-task sheet. */
export function WorkTaskComposer({
  serverId,
  agents,
  initialAgentId,
  disabled,
}: {
  serverId: string;
  agents: MobileAgent[];
  initialAgentId?: string;
  disabled: boolean;
}) {
  const { t, errorMessage } = useText();
  const { theme } = useUniwind();
  const [foreground, muted, action, actionForeground] = useCSSVariable([
    "--openbot-text-primary",
    "--openbot-text-grouped-secondary",
    "--openbot-action",
    "--openbot-action-foreground",
  ]);
  const navigation = useNavigation();
  const workspace = useMobileWorkspaceReader();
  const pinned = useMobileWorkspaceSelector((state) => state.pinnedAgentIds);
  const queryClient = useQueryClient();
  const scope = useQueryScope();
  const [selectedByServer, setSelectedByServer] = useState<Record<string, string>>({});
  const selectedId = selectedByServer[serverId] ?? initialAgentId ?? "";
  const setSelectedId = (id: string) => setSelectedByServer((current) => ({ ...current, [serverId]: id }));
  const firstPinned = pinned.map((id) => agents.find((agent) => agent.id === id)).find((agent) => agent !== undefined);
  const chosen = agents.find((agent) => agent.id === selectedId) ?? firstPinned ?? agents[0];
  const access = useAgentAccessLevel(serverId, chosen?.id ?? "");
  const canChat = access === "chat" || access === "manage";
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[serverId] ?? "";
  const setDraft = (value: string) => setDrafts((current) => ({ ...current, [serverId]: value }));
  const appliedTarget = useRef<{ serverId: string; agentId: string | undefined } | null>(null);
  useEffect(() => {
    if (appliedTarget.current?.serverId === serverId && appliedTarget.current.agentId === initialAgentId) return;
    appliedTarget.current = { serverId, agentId: initialAgentId };
    if (!initialAgentId || drafts[serverId]) return;
    setSelectedByServer((current) =>
      current[serverId] === initialAgentId ? current : { ...current, [serverId]: initialAgentId },
    );
  }, [drafts, initialAgentId, serverId]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const error = errors[serverId] ?? null;
  const setError = (value: string | null) => setErrors((current) => ({ ...current, [serverId]: value }));
  const pending = useRef(false);
  const dirty = Object.values(drafts).some((value) => Boolean(plainTaskTitle(value)));
  const canStart = !disabled && canChat && !saving && Boolean(plainTaskTitle(draft)) && Boolean(chosen);
  usePreventRemove(dirty || saving, ({ data }) => {
    if (pending.current) return;
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  async function start() {
    if (!canStart || !chosen || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const task = await workspace().startAgentTask(
        { agentId: chosen.id, text: draft, clientMessageId: Crypto.randomUUID() },
        serverId,
      );
      queryClient.setQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(scope, serverId, task.agentId), (stored) =>
        stored && !stored.tasks.some((entry) => entry.id === task.id)
          ? { ...stored, tasks: [task, ...stored.tasks] }
          : stored,
      );
      setDraft("");
      Keyboard.dismiss();
      void haptics.notification("success");
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.tasks.error.start")));
      void haptics.notification("error");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <View className="gap-3 border border-grouped-border bg-grouped pt-4 pr-2 pb-2 pl-4" style={{ borderRadius: 24 }}>
      <TextInput
        accessibilityLabel={t("mobile.server.tasks.ask")}
        placeholder={t("mobile.server.tasks.ask")}
        placeholderTextColor={String(muted)}
        value={draft}
        editable={!disabled && canChat && !saving}
        multiline
        maxLength={INPUT_LIMITS.messageText}
        onChangeText={(value) => {
          setDraft(value);
          if (error) setError(null);
        }}
        style={{
          fontFamily: "Inter",
          fontSize: 18,
          lineHeight: 24,
          fontWeight: "500",
          color: typeof foreground === "string" ? foreground : undefined,
          minHeight: 26,
          maxHeight: 160,
          padding: 0,
          paddingRight: 8,
          textAlignVertical: "top",
        }}
      />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text" type="body-sm">
          {error}
        </Typography.Paragraph>
      ) : null}
      <View className="flex-row items-center gap-2">
        <MenuView
          colorScheme={theme === "dark" ? "dark" : "light"}
          style={{ flexShrink: 1 }}
          actions={agents.map((agent) => ({
            id: agent.id,
            title: agent.name,
            state: chosen?.id === agent.id ? "on" : "off",
            attributes: { disabled: saving },
          }))}
          onPressAction={({ nativeEvent }) => {
            if (saving) return;
            setSelectedId(nativeEvent.event);
            void haptics.selection();
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              chosen ? t("mobile.server.tasks.agentLabel", { name: chosen.name }) : t("mobile.server.tasks.chooseAgent")
            }
            accessibilityState={{ disabled: saving || agents.length === 0 }}
            disabled={saving || agents.length === 0}
            className="min-h-11 max-w-full flex-row items-center gap-2 rounded-full border border-grouped-border bg-control pr-3 pl-2"
          >
            {chosen ? <TeamAgentAvatar agent={chosen} size={24} /> : null}
            <Typography.Paragraph
              numberOfLines={1}
              style={{ fontFamily: "Inter", fontSize: 14, lineHeight: 20, fontWeight: "600", flexShrink: 1 }}
            >
              {chosen?.name ?? t("mobile.server.tasks.chooseAgent")}
            </Typography.Paragraph>
            <ChevronDown size={14} color={String(muted)} />
          </Pressable>
        </MenuView>
        <View className="flex-1" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.server.tasks.start")}
          accessibilityState={{ disabled: !canStart, busy: saving }}
          disabled={!canStart}
          onPress={() => void start()}
          className="size-11 items-center justify-center rounded-full bg-control"
          style={canStart && typeof action === "string" ? { backgroundColor: action } : undefined}
        >
          {saving ? <Spinner size="sm" /> : <ArrowUp size={20} color={String(canStart ? actionForeground : muted)} />}
        </Pressable>
      </View>
    </View>
  );
}
