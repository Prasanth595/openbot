import type { RoutineFlowRoutineInfo, RoutineFlowStep, RoutineRunStatus } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { nextValidRoutineOccurrence } from "@openbot/team-client/routine-schedule";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { router, Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import AlarmClock from "lucide-react-native/icons/alarm-clock";
import Check from "lucide-react-native/icons/check";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Play from "lucide-react-native/icons/play";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import {
  KeyboardAvoidingView,
  useKeyboardState,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable, useUniwind } from "uniwind";
import { TeamAgentAvatar } from "@/features/agents/components/team-agent-avatar";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { ChatComposer } from "@/features/chat/components/chat-composer";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { useVoiceMode } from "@/features/chat/components/use-voice-mode";
import { routineScheduleSummary } from "@/features/servers/model/routine-schedule-summary";
import { useAgentAccessLevel } from "@/features/servers/model/use-server-roles";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { useLiquidGlass } from "@/shared/lib/use-liquid-glass";

const STATUS_TEXT = {
  queued: "mobile.server.routineDetail.status.queued",
  running: "mobile.server.routineDetail.status.running",
  "needs-attention": "mobile.server.routineDetail.status.needsAttention",
  succeeded: "mobile.server.routineDetail.status.succeeded",
  failed: "mobile.server.routineDetail.status.failed",
  interrupted: "mobile.server.routineDetail.status.interrupted",
  cancelled: "mobile.server.routineDetail.status.cancelled",
  skipped: "mobile.server.routineDetail.status.skipped",
  active: "mobile.server.routines.status.active",
  paused: "mobile.server.routines.status.paused",
} as const satisfies Record<RoutineRunStatus | RoutineFlowStep["status"] | "active" | "paused", MobileTextKey>;

const SOURCE_TEXT = {
  scheduled: "mobile.server.routineDetail.source.scheduled",
  test: "mobile.server.routineDetail.source.test",
  script: "mobile.server.routineDetail.source.script",
  webhook: "mobile.server.routineDetail.source.webhook",
} as const satisfies Record<string, MobileTextKey>;

export function RoutineDetailScreen() {
  const text = useText();
  const liquidGlass = useLiquidGlass();
  const { t, format, errorMessage } = text;
  const { agentId, serverId, recordId, runId } = useLocalSearchParams<{
    agentId: string;
    serverId?: string;
    recordId: string;
    runId?: string;
  }>();
  const [selectedRunId, setSelectedRunId] = useState(runId);
  const workspace = useMobileWorkspace();
  const [hostId] = useState(serverId ?? workspace.activeServer.id);
  const agent = workspace.agents.find((item) => item.id === agentId && item.serverId === hostId);
  const host = workspace.servers.find((item) => item.id === hostId);
  const available = Boolean(agent && showsOnline(host));
  const access = useAgentAccessLevel(hostId, agentId);
  const canChat = available && (access === "chat" || access === "manage");
  const [apiUrl, userId, sessionScope] = useQueryScope();
  const queryScope = useMemo(() => [apiUrl, userId, sessionScope] as const, [apiUrl, userId, sessionScope]);
  const client = useQueryClient();
  const routinesKey = queryKeys.agentRecord(queryScope, hostId, agentId, "routines");
  const flowKey = queryKeys.agentRoutineFlow(queryScope, hostId, agentId);
  const routines = useQuery({
    queryKey: routinesKey,
    queryFn: () => workspace.loadAgentRoutines(agentId, hostId),
    enabled: available,
    retry: false,
    staleTime: 0,
  });
  const flow = useQuery({
    queryKey: flowKey,
    queryFn: () => workspace.loadAgentRoutineFlow(agentId, hostId),
    enabled: available,
    retry: false,
    staleTime: 0,
  });
  const entry = flow.data?.routines.find((item) => item.routine.id === recordId);
  const basic = routines.data?.find((item) => item.id === recordId);
  const routine: RoutineFlowRoutineInfo | undefined =
    entry?.routine ??
    (basic
      ? {
          ...basic,
          trigger: { kind: "schedule", schedule: basic.trigger.schedule },
        }
      : undefined);
  // Old hosts provide run dates and statuses through the existing calendar, without step output.
  const [range] = useState(() => {
    const now = Date.now();
    return { from: new Date(now - 30 * 86_400_000).toISOString(), to: new Date(now + 7 * 86_400_000).toISOString() };
  });
  const history = useQuery({
    queryKey: [
      ...queryKeys.serverRoutines(queryScope, hostId),
      "routine-detail",
      agentId,
      recordId,
      range.from,
      range.to,
    ],
    queryFn: () => workspace.loadRoutineCalendar(range, hostId, [{ kind: "agent", agentId }]),
    enabled: available && flow.data === null,
    retry: false,
    staleTime: 0,
  });
  const latest = entry?.recentRuns[0];
  const selected = selectedRunId ? entry?.recentRuns.find((run) => run.id === selectedRunId) : latest;
  const oldHostRun = history.data?.runs
    .filter((run) => run.routineId === recordId && run.status !== "scheduled")
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .find((run) => !selectedRunId || run.id === selectedRunId);
  const status =
    selected?.status ??
    (oldHostRun?.status !== "scheduled" ? oldHostRun?.status : undefined) ??
    (selectedRunId ? undefined : routine?.active ? "active" : "paused");
  const steps = selected ? (entry?.steps.filter((step) => step.runId === selected.id) ?? []) : [];
  const [busy, setBusy] = useState<"run" | "toggle" | "delete" | "send" | null>(null);
  const [finished, setFinished] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sendRetryVersion, setSendRetryVersion] = useState(0);
  const sendRequest = useRef<{ text: string; id: string } | null>(null);
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const { theme } = useUniwind();
  const foreground = String(useCSSVariable("--openbot-text-primary"));
  const muted = String(useCSSVariable("--openbot-text-muted"));
  const canvas = String(useCSSVariable("--openbot-bg-canvas"));
  const glass = String(useCSSVariable("--openbot-bg-chrome-glass"));
  const ink = String(useCSSVariable("--openbot-text-on-light"));
  const raised = String(useCSSVariable("--openbot-bg-surface-raised"));
  const canEdit =
    access === "manage" && !busy && (routine?.trigger.kind !== "webhook" || workspace.canManageEvents(hostId));
  const canChange = available && canEdit;
  const permissions = useRef({ canChange, canEdit });
  permissions.current = { canChange, canEdit };

  const refresh = useCallback(() => {
    return Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.agentRecord(queryScope, hostId, agentId, "routines") }),
      client.invalidateQueries({ queryKey: queryKeys.serverRoutines(queryScope, hostId) }),
    ]);
  }, [client, queryScope, hostId, agentId]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function act(kind: "run" | "toggle" | "delete") {
    if (!routine || !permissions.current.canChange || pending.current) return;
    pending.current = true;
    setBusy(kind);
    setError(null);
    try {
      const owner = { kind: "agent", id: agentId } as const;
      if (kind === "run") {
        if (routine.trigger.kind === "webhook") await workspace.testEventRoutine({ id: routine.id, owner }, hostId);
        else await workspace.testAgentRoutine(agentId, routine.id, hostId);
        setSelectedRunId(undefined);
      } else if (kind === "toggle") {
        if (routine.trigger.kind === "webhook") {
          await workspace.saveEventRoutine(
            {
              id: routine.id,
              owner,
              name: routine.name,
              instruction: routine.instruction,
              active: !routine.active,
              timezone: routine.timezone,
              trigger: { kind: "webhook", eventType: routine.trigger.eventType, filters: routine.trigger.filters },
              ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
              ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
            },
            hostId,
          );
        } else await workspace.updateAgentRoutine({ agentId, routineId: routine.id, active: !routine.active }, hostId);
      } else {
        if (routine.trigger.kind === "webhook") await workspace.deleteEventRoutine({ id: routine.id, owner }, hostId);
        else await workspace.deleteAgentRoutine(agentId, routine.id, hostId);
      }
      void haptics.notification("success");
      await refresh();
      if (kind === "delete") setFinished(true);
    } catch (cause) {
      setError(
        errorMessage(cause, t(kind === "run" ? "mobile.agent.record.testFailed" : "mobile.agent.record.saveFailed")),
      );
      void haptics.notification("error");
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function send(text: string) {
    if (!agent || !routine || !canChat || pending.current || !text.trim()) return;
    pending.current = true;
    setBusy("send");
    setError(null);
    const request = sendRequest.current?.text === text ? sendRequest.current : { text, id: Crypto.randomUUID() };
    sendRequest.current = request;
    try {
      const messageId = await workspace.sendMessage(
        agentId,
        t("mobile.server.routineDetail.chatContext", { name: routine.name, id: routine.id, message: text }),
        [],
        null,
        hostId,
        workspace.canRetryMessage(hostId) ? request.id : undefined,
      );
      setDraft("");
      sendRequest.current = null;
      router.push({ pathname: "/chat/[agentId]", params: { agentId, serverId: hostId, messageId } });
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.routineDetail.sendFailed")));
      setSendRetryVersion((value) => value + 1);
      void haptics.notification("error");
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }
  const voice = useVoiceMode({
    enabled: isFocused && canChat && !busy,
    focused: isFocused,
    sendable: canChat && !busy,
    onSend: (value) => void send(value),
  });
  const navigation = useNavigation();
  usePreventRemove((Boolean(draft.trim() || voice.transcript.trim()) && !finished) || busy === "send", ({ data }) => {
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
  const edit = () => {
    if (!permissions.current.canEdit) return;
    router.push({ pathname: "/server-routines/edit-routine", params: { agentId, serverId: hostId, recordId } });
  };
  const actions: MenuAction[] = routine
    ? [
        {
          id: "toggle",
          title: t(routine.active ? "mobile.server.routineDetail.pause" : "mobile.server.routineDetail.resume"),
          attributes: { disabled: !canChange },
        },
        {
          id: "edit",
          title: t("mobile.server.routineDetail.edit"),
          image: "gearshape",
          attributes: { disabled: !canEdit },
        },
        {
          id: "delete",
          title: t("mobile.agent.record.deleteRoutine"),
          image: "trash",
          attributes: { disabled: !canChange, destructive: true },
        },
      ]
    : [];
  function onMenu(id: string) {
    if (id !== "edit" && !permissions.current.canChange) return;
    if (id === "toggle") void act("toggle");
    if (id === "edit") edit();
    if (id === "delete")
      Alert.alert(t("mobile.agent.record.deleteRoutineTitle"), t("mobile.agent.record.deleteRoutineBody"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: () => void act("delete") },
      ]);
  }
  const lastAt = selected?.scheduledFor ?? oldHostRun?.at;
  const timeText = (value: string | undefined) => {
    if (!value || !Number.isFinite(Date.parse(value))) return null;
    try {
      return format.date(new Date(value), {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: routine?.timezone,
      });
    } catch {
      // A malformed stored zone must not prevent access to the routine's editor.
      return null;
    }
  };
  let next = entry?.upcomingRuns[0];
  if (!next && routine?.active && routine.trigger.kind === "schedule") {
    try {
      next = nextValidRoutineOccurrence(routine.trigger.schedule, routine.timezone, new Date()).toISOString();
    } catch {
      /* Invalid stored schedules keep their history and remain editable. */
    }
  }
  const lastTime = timeText(lastAt);
  const nextTime = routine?.active ? timeText(next) : null;
  const source = selected
    ? t(SOURCE_TEXT[selected.kind === "scheduled" ? "scheduled" : (selected.source ?? "test")])
    : null;
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: canvas }}>
      <Stack.Title large>{routine?.name ?? t("mobile.server.routineDetail.heading")}</Stack.Title>
      {isAndroid ? (
        // Android toolbar menus require an image source; keep the shared menu adapter and Lucide trigger.
        <Stack.Screen
          options={{
            headerRight: () => (
              <MenuView
                colorScheme={theme === "dark" ? "dark" : "light"}
                actions={actions}
                onPressAction={({ nativeEvent }) => onMenu(nativeEvent.event)}
              >
                <View
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.agent.menu.more")}
                  className="size-12 items-center justify-center"
                >
                  <Ellipsis size={22} color={foreground} />
                </View>
              </MenuView>
            ),
          }}
        />
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={t("mobile.agent.menu.more")}>
            {actions.map((action) => (
              <Stack.Toolbar.MenuAction
                key={action.id}
                disabled={action.attributes?.disabled}
                destructive={action.attributes?.destructive}
                onPress={() => {
                  if (action.id) onMenu(action.id);
                }}
              >
                {action.title}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
      >
        {routine ? (
          <>
            <View style={{ gap: 10 }}>
              <View className="flex-row flex-wrap items-center gap-2">
                {status ? <RoutineStatus status={status} /> : null}
                {lastTime ? (
                  <Typography.Paragraph className="text-text-secondary" style={styles.meta}>
                    {t(
                      selectedRunId && (!selected || selected.id !== latest?.id)
                        ? "mobile.server.routineDetail.runAt"
                        : "mobile.server.routineDetail.lastRun",
                      { time: lastTime },
                    )}
                  </Typography.Paragraph>
                ) : null}
              </View>
              {source ? (
                <Typography.Paragraph className="text-muted" style={styles.source}>
                  {t("mobile.server.routineDetail.startedBy", { source })}
                </Typography.Paragraph>
              ) : null}
            </View>
            <View className="bg-feature" style={styles.trigger}>
              <View className="flex-row items-center gap-2">
                <AlarmClock size={16} color={ink} />
                <Typography.Paragraph className="text-on-feature" style={styles.kicker}>
                  {nextTime
                    ? t("mobile.server.routineDetail.next", { time: nextTime })
                    : t(
                        routine.trigger.kind === "webhook"
                          ? "mobile.agent.record.trigger.webhook"
                          : routine.active
                            ? "mobile.server.routines.status.active"
                            : "mobile.server.routines.status.paused",
                      )}
                </Typography.Paragraph>
              </View>
              <Typography.Heading className="text-on-feature" style={styles.cadence}>
                {routine.trigger.kind === "schedule"
                  ? routineScheduleSummary(routine.trigger.schedule, text)
                  : t("mobile.agent.trigger.webhookDescription")}
              </Typography.Heading>
              <View style={{ borderLeftWidth: 2, borderLeftColor: ink, paddingLeft: 10 }}>
                <Typography.Paragraph className="text-on-feature" style={styles.body} numberOfLines={4}>
                  {selected?.instruction ?? routine.instruction}
                </Typography.Paragraph>
              </View>
            </View>
            {steps.map((step, index) => (
              <View key={step.id}>
                <View className="bg-grouped-border" style={styles.connector} />
                <RoutineStepCard
                  step={step}
                  index={index}
                  agent={workspace.agents.find((item) => item.id === step.agentId && item.serverId === hostId)}
                />
              </View>
            ))}
            {!steps.length ? (
              <Typography.Paragraph className="text-muted" style={styles.body}>
                {t(
                  flow.isPending
                    ? "mobile.agent.info.routine.loading"
                    : flow.data === null
                      ? "mobile.server.routineDetail.stepsUnavailable"
                      : selectedRunId && selectedRunId !== latest?.id
                        ? "mobile.server.routineDetail.olderSteps"
                        : selected || flow.isError
                          ? "mobile.server.routineDetail.stepsPending"
                          : "mobile.server.routineDetail.emptyRuns",
                )}
              </Typography.Paragraph>
            ) : null}
            {selected?.error ? (
              <Typography.Paragraph accessibilityRole="alert" className="text-danger-text" style={styles.body}>
                {text.sourceText(selected.error)}
              </Typography.Paragraph>
            ) : null}
          </>
        ) : (
          <Typography.Paragraph className="text-muted">
            {t(
              !available
                ? "mobile.server.routines.offline"
                : routines.isPending || flow.isPending
                  ? "mobile.agent.info.routine.loading"
                  : "mobile.server.routineDetail.unavailable",
            )}
          </Typography.Paragraph>
        )}
        {routines.isError || flow.isError || history.isError ? (
          <View className="gap-2">
            <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
              {t("mobile.agent.info.routine.failed")}
            </Typography.Paragraph>
            <Button variant="ghost" onPress={refresh}>
              <Button.Label>{t("common.retry")}</Button.Label>
            </Button>
          </View>
        ) : null}
        {!available && routine ? (
          <Typography.Paragraph className="text-muted">{t("mobile.server.routines.offline")}</Typography.Paragraph>
        ) : null}
        {error ? (
          <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
            {error}
          </Typography.Paragraph>
        ) : null}
      </ScrollView>
      {routine && agent ? (
        <View className="border-t border-grouped-border bg-team-canvas" style={{ paddingTop: 12 }}>
          <Button
            variant="secondary"
            isDisabled={!canChange}
            onPress={() => void act("run")}
            style={{ marginHorizontal: 20, height: 52, borderRadius: 999, backgroundColor: foreground }}
          >
            <Button.Label style={[styles.meta, { color: canvas, fontSize: 15, fontWeight: "600" }]}>
              {t(busy === "run" ? "mobile.agent.record.testStarting" : "mobile.server.routineDetail.runNow")}
            </Button.Label>
            <Play size={16} color={canvas} />
          </Button>
          <ChatComposer
            action={foreground}
            actionForeground={canvas}
            agentName={agent.name}
            placeholder={t("mobile.server.routineDetail.ask")}
            mentionAgents={workspace.agents.filter((item) => item.serverId === hostId)}
            bottomInset={keyboardVisible ? 0 : insets.bottom}
            disabled={!canChat || Boolean(busy)}
            draft={draft}
            fallbackBackground={glass}
            foreground={foreground}
            liquidGlassAvailable={liquidGlass}
            muted={muted}
            raised={raised}
            onChangeDraft={setDraft}
            onSend={(value) => void send(value)}
            keyboardProgress={keyboardProgress}
            sendRetryVersion={sendRetryVersion}
            replyTarget={null}
            replyFocusVersion={0}
            onCancelReply={() => undefined}
            voice={voice}
          />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function RoutineStatus({ status }: { status: keyof typeof STATUS_TEXT }) {
  const { t } = useText();
  const failed = status === "failed" || status === "interrupted";
  const success = status === "succeeded";
  return (
    <View
      className={success ? "bg-success/15" : failed ? "bg-danger/15" : "bg-control"}
      style={{ borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}
    >
      <Typography.Paragraph
        className={success ? "text-success-text" : failed ? "text-danger-text" : "text-muted"}
        style={styles.status}
      >
        {t(STATUS_TEXT[status])}
      </Typography.Paragraph>
    </View>
  );
}

function RoutineStepCard({
  step,
  index,
  agent,
}: {
  step: RoutineFlowStep;
  index: number;
  agent: MobileAgent | undefined;
}) {
  const text = useText();
  const success = String(useCSSVariable("--openbot-success-text"));
  const secondary = String(useCSSVariable("--openbot-text-secondary"));
  return (
    <View className="border border-grouped-border bg-team-surface" style={styles.step}>
      <View className="flex-row items-center gap-2.5">
        <Typography.Paragraph className="text-muted" style={styles.kicker}>
          {text.format.number(index + 1, { minimumIntegerDigits: 2 })}
        </Typography.Paragraph>
        {agent ? <TeamAgentAvatar agent={agent} size={28} /> : null}
        <View className="min-w-0 flex-1">
          <Typography.Paragraph style={styles.agent}>
            {agent?.name ?? text.t("mobile.chat.exchange.unknownAgent")}
          </Typography.Paragraph>
          {agent?.title ? (
            <Typography.Paragraph className="text-muted" style={styles.source}>
              {agent.title}
            </Typography.Paragraph>
          ) : null}
        </View>
        {step.status === "succeeded" ? <Check size={14} color={success} /> : null}
        <Typography.Paragraph
          className={
            step.status === "succeeded"
              ? "text-success-text"
              : step.status === "failed"
                ? "text-danger-text"
                : "text-muted"
          }
          style={styles.source}
        >
          {text.t(STATUS_TEXT[step.status])}
        </Typography.Paragraph>
      </View>
      {step.input ? (
        <Typography.Paragraph selectable className="text-text-secondary" style={styles.body} numberOfLines={2}>
          {step.input}
        </Typography.Paragraph>
      ) : null}
      {step.output ? (
        <View className="bg-sheet" style={{ borderRadius: 10, padding: 12 }}>
          <ChatMarkdown
            body={step.output}
            compact
            bodyLineHeight={20.3}
            color={secondary}
            animationEnabled={false}
            finished
          />
        </View>
      ) : null}
      {step.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text" style={styles.body}>
          {text.sourceText(step.error)}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 16 },
  kicker: {
    fontFamily: "Inter",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },
  status: {
    fontFamily: "Inter",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "600",
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },
  meta: { fontFamily: "Inter", fontSize: 14, lineHeight: 20, fontWeight: "500" },
  source: { fontFamily: "Inter", fontSize: 13, lineHeight: 18 },
  body: { fontFamily: "Inter", fontSize: 14, lineHeight: 20.3 },
  cadence: { fontFamily: "Inter", fontSize: 20, lineHeight: 25, fontWeight: "600", letterSpacing: -0.6 },
  trigger: { borderRadius: 24, padding: 16, gap: 10 },
  connector: { width: 2, height: 20, marginLeft: 28, marginBottom: 16 },
  step: { borderRadius: 24, padding: 16, gap: 12 },
  agent: { fontFamily: "Inter", fontSize: 15, lineHeight: 20, fontWeight: "600" },
});
