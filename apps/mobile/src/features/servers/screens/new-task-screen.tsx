import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { plainTaskTitle } from "@openbot/team-client/agent-tasks";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import ChevronsDownUp from "lucide-react-native/icons/chevrons-down-up";
import ChevronsUpDown from "lucide-react-native/icons/chevrons-up-down";
import X from "lucide-react-native/icons/x";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useServerTasks } from "@/features/servers/model/use-server-tasks";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

const AVATAR_SIZE = 26;

/** Agents whose name or title has the query, in the order of the list. */
function matchAgents(agents: readonly MobileAgent[], query: string): MobileAgent[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...agents];
  return agents.filter(
    (agent) => agent.name.toLocaleLowerCase().includes(needle) || agent.title.toLocaleLowerCase().includes(needle),
  );
}

/**
 * Starts a task: what to do, and the agent that does it, chosen in a field that searches the agents.
 * The task shows in the lists at once, and the sheet closes.
 */
export function NewTaskScreen() {
  const { t, errorMessage } = useText();
  const { serverId, agentId: initialAgentId } = useLocalSearchParams<{ serverId: string; agentId?: string }>();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const reduced = useReducedMotion();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const accent = String(useCSSVariable("--openbot-accent"));
  const { startAgentTask } = useMobileWorkspace();
  const { agents, online, supported } = useServerTasks(serverId, { enabled: false });
  const [draft, setDraft] = useState("");
  const [chosenId, setChosenId] = useState(initialAgentId ?? "");
  const [picking, setPicking] = useState(!initialAgentId);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const chosen = agents.find((agent) => agent.id === chosenId);
  const title = plainTaskTitle(draft);
  const dirty = title !== "";
  const canSave = online && supported && Boolean(chosen) && dirty && !finished;
  const matches = matchAgents(agents, query);
  const Toggle = picking ? ChevronsDownUp : ChevronsUpDown;
  const fade = reduced ? undefined : FadeIn.duration(180);
  const fadeOut = reduced ? undefined : FadeOut.duration(120);

  usePreventRemove(!finished && (dirty || saving), ({ data }) => {
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
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);

  async function start() {
    if (!canSave || !chosen || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const task = await startAgentTask(
        { agentId: chosen.id, text: draft, clientMessageId: Crypto.randomUUID() },
        serverId,
      );
      // The task shows before its list event arrives.
      queryClient.setQueryData<AgentTasksSnapshot>(
        queryKeys.agentTasks(queryScope, serverId, task.agentId),
        (stored) =>
          stored && !stored.tasks.some((entry) => entry.id === task.id)
            ? { ...stored, tasks: [task, ...stored.tasks] }
            : stored,
      );
      void haptics.notification("success");
      setFinished(true);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.server.tasks.error.start")));
      pending.current = false;
      setSaving(false);
    }
  }

  const close = () => {
    void haptics.impact("soft");
    router.back();
  };

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t("mobile.server.tasks.new") }} />
      {isAndroid ? (
        <AndroidHeaderButton
          placement="left"
          icon={X}
          accessibilityLabel={t("common.close")}
          disabled={saving}
          onPress={close}
        />
      ) : (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="xmark" accessibilityLabel={t("common.close")} disabled={saving} onPress={close}>
            {t("common.close")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <SheetSaveAction
        dirty={dirty}
        canSave={canSave}
        pending={saving}
        label={t("mobile.server.tasks.start")}
        onSave={() => void start()}
      />
      <SheetFormField
        label={t("mobile.server.tasks.ask")}
        hideLabel
        appearance="soft"
        multiline
        autoFocus={Boolean(initialAgentId)}
        editable={!saving}
        maxLength={INPUT_LIMITS.messageText}
        placeholder={t("mobile.server.tasks.ask")}
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          if (error) setError(null);
        }}
      />
      <View className="gap-2">
        <SettingsSection title={t("mobile.server.tasks.chooseAgent")}>
          <SettingsRow
            accessibilityLabel={
              chosen
                ? t("mobile.server.tasks.agentLabel", { name: chosen.name })
                : t("mobile.server.tasks.chooseAgentPlaceholder")
            }
            expanded={picking}
            leading={chosen ? <TaskAgentAvatar agent={chosen} /> : undefined}
            trailing={<Toggle size={18} color={muted} strokeWidth={1.5} />}
            onPress={() => {
              void haptics.selection();
              setPicking((open) => !open);
              setQuery("");
            }}
          >
            <Typography.Paragraph numberOfLines={1} className={chosen ? undefined : "text-grouped-secondary"}>
              {chosen?.name ?? t("mobile.server.tasks.chooseAgentPlaceholder")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
        {picking ? (
          <Animated.View entering={fade} exiting={fadeOut} className="gap-2">
            <SheetFormField
              label={t("mobile.server.tasks.searchAgents")}
              hideLabel
              appearance="soft"
              autoCorrect={false}
              autoCapitalize="none"
              autoFocus={!initialAgentId && agents.length > 6}
              placeholder={t("mobile.server.tasks.searchAgents")}
              returnKeyType="done"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => {
                const [only] = matches;
                if (matches.length !== 1 || !only) return;
                void haptics.selection();
                setChosenId(only.id);
                setPicking(false);
              }}
            />
            {matches.length > 0 ? (
              <SettingsSection>
                {matches.map((agent) => (
                  <SettingsRow
                    key={agent.id}
                    checked={agent.id === chosenId}
                    disclosure={false}
                    leading={<TaskAgentAvatar agent={agent} />}
                    supportingText={agent.title.trim() || undefined}
                    trailing={agent.id === chosenId ? <Check size={18} color={accent} strokeWidth={2} /> : null}
                    onPress={() => {
                      void haptics.selection();
                      setChosenId(agent.id);
                      setPicking(false);
                      setQuery("");
                    }}
                  >
                    <Typography.Paragraph numberOfLines={1}>{agent.name}</Typography.Paragraph>
                  </SettingsRow>
                ))}
              </SettingsSection>
            ) : (
              <Typography.Paragraph className="px-4 text-muted">
                {agents.length === 0
                  ? t("mobile.server.tasks.noAgents")
                  : t("mobile.server.tasks.noAgentMatch", { query: query.trim() })}
              </Typography.Paragraph>
            )}
          </Animated.View>
        ) : null}
      </View>
      {!online || !supported ? (
        <Typography.Paragraph className="text-muted">
          {t(online ? "mobile.server.tasks.unsupported" : "mobile.server.tasks.offline")}
        </Typography.Paragraph>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}

function TaskAgentAvatar({ agent }: { agent: MobileAgent }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <BloubAvatar
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        seed={agent.avatarSeed}
        size={AVATAR_SIZE}
        animateIdle={false}
      />
    </View>
  );
}
