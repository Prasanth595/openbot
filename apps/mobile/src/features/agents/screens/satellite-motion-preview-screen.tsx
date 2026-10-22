import { AVATAR_HUES } from "@openbot/contracts/ipc";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { SatelliteMotionProvider } from "@/features/agents/components/agent-activity-satellites";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import type { SatellitePhase } from "@/features/agents/model/satellite-motion";
import { ChatActivityRow } from "@/features/chat/components/chat-activity-row";
import { ChatHeader } from "@/features/chat/components/chat-header";
import { presentChatActivity } from "@/features/chat/model/chat-activity";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { reduceAgentActivity } from "@/features/workspace/model/agent-activity";
import { runConversationCacheProbe } from "@/features/workspace/model/conversation-cache-probe";
import { useText } from "@/shared/lib/text";

const SIZES = [24, 36, 64, 88];
const SEEDS = ["jarvis", "school", "fitness", "finance", "cto", "padel"];

declare global {
  var __OPENBOT_CHAT_CACHE_PREVIEW__: { ready: boolean; checks: Record<string, boolean> } | undefined;
  var __OPENBOT_MOTION_PREVIEW__:
    | {
        phase: SatellitePhase;
        ready: boolean;
        active: boolean;
        rowVisible: boolean;
        showReply: boolean;
        checks: Record<string, boolean>;
      }
    | undefined;
}

/** Exercise out-of-order events through the actual mobile reducer and presentation, without a host run. */
function previewActivity(phase: SatellitePhase, showReply = false) {
  const ids = { agentId: "motion-preview-agent", threadId: "motion-preview-thread", turnId: "motion-preview-turn" };
  const start = { type: "turn-started", ...ids } as const;
  const delta = {
    type: "conversation-delta",
    ...ids,
    messageId: "motion-preview-message",
    delta: "",
    createdAt: "2026-10-22T00:00:00Z",
    revision: 1,
  } as const;
  const progress = { type: "turn-progress", ...ids, detail: "" } as const;
  const working = reduceAgentActivity({}, start);
  const writing = reduceAgentActivity(working, delta);
  const tool = reduceAgentActivity(writing, progress);
  const finished = reduceAgentActivity(writing, { type: "turn-completed", ...ids, status: "completed" });
  const cancelled = reduceAgentActivity(writing, { type: "turn-completed", ...ids, status: "cancelled" });
  const messages: ChatMessage[] = [
    { id: delta.messageId, kind: "message", author: "agent", body: "", streaming: true, turnId: ids.turnId },
  ];
  const inputs = { activeTurnId: ids.turnId, messages, sending: false, awaitingTurn: false };
  const terminal = presentChatActivity({
    ...inputs,
    activity: writing[ids.agentId],
    completion: finished[ids.agentId],
  });
  const optimistic = presentChatActivity({ ...inputs, messages: [], activeTurnId: null, sending: true });
  const generating = presentChatActivity({ ...inputs, activity: writing[ids.agentId] });
  const usingTool = presentChatActivity({ ...inputs, activity: tool[ids.agentId] });
  const cancelledPresentation = presentChatActivity({ ...inputs, completion: cancelled[ids.agentId] });
  const next = reduceAgentActivity(finished, { ...start, turnId: "motion-preview-next-turn" });
  const nextPresentation = presentChatActivity({
    ...inputs,
    activeTurnId: "motion-preview-next-turn",
    activity: next[ids.agentId],
    completion: finished[ids.agentId],
  });
  const replyMessages: ChatMessage[] = [
    {
      id: delta.messageId,
      kind: "message",
      author: "agent",
      body: "Fixture reply",
      streaming: true,
      turnId: ids.turnId,
    },
  ];
  const replyStarted = presentChatActivity({ ...inputs, activity: writing[ids.agentId], messages: replyMessages });
  const replySettled = presentChatActivity({
    ...inputs,
    activity: writing[ids.agentId],
    messages: [
      {
        id: delta.messageId,
        kind: "message",
        author: "agent",
        body: "Fixture reply",
        streaming: false,
        turnId: ids.turnId,
      },
    ],
  });
  const restored = reduceAgentActivity(finished, {
    type: "runtime-snapshot",
    snapshot: {
      agents: [],
      activeTurns: [ids],
      work: [],
      latestMessages: [],
      attentionComplete: true,
      pendingPrompts: [],
      pendingApprovals: [],
      pendingBrowserTakeovers: [],
      failedTurns: [],
    },
  });
  const checks = {
    optimisticSendStartsActivity: optimistic.active && optimistic.phase === "thinking",
    streamedTextShowsWriting: generating.active && generating.phase === "generating",
    toolProgressShowsTool: usingTool.active && usingTool.phase === "tool",
    completionStopsStaleStream: !terminal.active && terminal.phase === "done",
    oldStreamDoesNotKeepActivity: !presentChatActivity({
      ...inputs,
      activeTurnId: null,
      messages: [
        ...messages,
        {
          id: "motion-preview-final",
          kind: "message",
          author: "agent",
          body: "",
          streaming: false,
          turnId: "motion-preview-newer-turn",
        },
      ],
    }).active,
    lateTextDoesNotRestart: reduceAgentActivity(finished, delta) === finished,
    lateToolDoesNotRestart: reduceAgentActivity(finished, progress) === finished,
    lateStartDoesNotRestart: reduceAgentActivity(finished, start) === finished,
    duplicateCompletionDoesNotReplay:
      reduceAgentActivity(finished, { type: "turn-completed", ...ids, status: "completed" }) === finished,
    newTurnCanStart: nextPresentation.active && nextPresentation.phase === "thinking",
    staleRuntimeSnapshotDoesNotRestart: restored[ids.agentId]?.phase === "finished",
    cancellationDoesNotCelebrate: !cancelledPresentation.active && cancelledPresentation.phase === "idle",
    emptyReplyKeepsPlaceholder: generating.showRow,
    firstReplyReplacesPlaceholder: replyStarted.active && !replyStarted.showRow && replyStarted.phase === "generating",
    completedTextDoesNotRestorePlaceholder: replySettled.active && !replySettled.showRow,
    previousReplyDoesNotHideNewTurn: nextPresentation.active && nextPresentation.showRow,
    staleStreamingPageDoesNotRestartActivity: !presentChatActivity({
      ...inputs,
      activeTurnId: null,
      messages: replyMessages,
    }).active,
    toolStatusRemainsAvailable: presentChatActivity({
      ...inputs,
      activity: tool[ids.agentId],
      messages: replyMessages,
    }).showRow,
    completionRemovesPlaceholder: !terminal.showRow,
  };
  const presentation =
    phase === "done"
      ? terminal
      : phase === "generating"
        ? showReply
          ? replyStarted
          : generating
        : phase === "tool"
          ? usingTool
          : phase === "thinking"
            ? optimistic
            : cancelledPresentation;
  return { presentation, checks };
}

function SynchronizedChatPreview({
  phase,
  animate,
  showReply,
}: {
  phase: SatellitePhase;
  animate: boolean;
  showReply: boolean;
}) {
  const { t, sourceText } = useText();
  const agent = useMobileWorkspaceSelector((workspace) =>
    workspace.agents.find((item) => item.serverId === workspace.activeServer.id),
  );
  const [foreground, muted, canvas] = useCSSVariable([
    "--openbot-text-primary",
    "--openbot-text-secondary",
    "--openbot-bg-canvas",
  ]);
  const fixture = useMemo(() => previewActivity(phase, showReply), [phase, showReply]);
  const { presentation, checks } = fixture;
  useEffect(() => {
    if (!__DEV__) return;
    globalThis.__OPENBOT_MOTION_PREVIEW__ = {
      phase,
      ready: Boolean(agent),
      active: presentation.active,
      rowVisible: presentation.showRow,
      showReply,
      checks,
    };
    return () => {
      globalThis.__OPENBOT_MOTION_PREVIEW__ = undefined;
    };
  }, [phase, presentation.active, presentation.showRow, showReply, checks, agent]);
  if (!agent) return null;
  const label =
    presentation.phase === "tool"
      ? sourceText("Working through the next tool-assisted step…")
      : t(presentation.phase === "generating" ? "mobile.chat.activity.responding" : "mobile.chat.activity.thinking");
  return (
    <SatelliteMotionProvider agentId={agent.id} serverId={agent.serverId} phase={presentation.phase} enabled={animate}>
      <View style={{ minHeight: 160 }}>
        <View style={{ height: 140 }}>
          <ChatHeader
            target={{ ...agent, kind: "agent" }}
            fallbackBackground={String(canvas)}
            foreground={String(foreground)}
            liquidGlassAvailable={false}
            topInset={0}
            onBack={() => router.back()}
          />
        </View>
        {showReply ? (
          <View className="gap-2 px-4 pb-3">
            <Typography.Paragraph weight="semibold">{agent.name}</Typography.Paragraph>
            <Typography.Paragraph>{t("mobile.chat.message.text")}</Typography.Paragraph>
          </View>
        ) : null}
        {presentation.showRow ? (
          <ChatActivityRow
            spec={{
              key: agent.id,
              label,
              accessibilityLabel: label,
              agent,
              mood: "idle",
              activityPhase: presentation.phase,
              online: true,
              animateAvatar: animate,
              shimmer: false,
            }}
            foreground={String(foreground)}
            muted={String(muted)}
          />
        ) : null}
      </View>
    </SatelliteMotionProvider>
  );
}

/** Local artwork only. No host, messages, tools or preferences change in this development page. */
export function SatelliteMotionPreviewScreen() {
  const { t, sourceText } = useText();
  const { theme } = useUniwind();
  const params = useLocalSearchParams<{ phase?: string; still?: string; cache?: string; reply?: string }>();
  const requested: SatellitePhase =
    params.phase === "idle" || params.phase === "generating" || params.phase === "tool" || params.phase === "done"
      ? params.phase
      : "thinking";
  useEffect(() => {
    if (!__DEV__ || params.cache !== "1") return;
    let cancelled = false;
    globalThis.__OPENBOT_CHAT_CACHE_PREVIEW__ = { ready: false, checks: {} };
    void runConversationCacheProbe().then(
      (checks) => {
        if (!cancelled) globalThis.__OPENBOT_CHAT_CACHE_PREVIEW__ = { ready: true, checks };
      },
      () => {
        if (!cancelled) globalThis.__OPENBOT_CHAT_CACHE_PREVIEW__ = { ready: true, checks: { probeCompleted: false } };
      },
    );
    return () => {
      cancelled = true;
      globalThis.__OPENBOT_CHAT_CACHE_PREVIEW__ = undefined;
    };
  }, [params.cache]);
  const [phase, setPhase] = useState<SatellitePhase>(requested);
  const [animate, setAnimate] = useState(params.still !== "1");
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    setPhase(requested);
    setAnimate(params.still !== "1");
  }, [params.still, requested]);
  const choices: { phase: SatellitePhase; label: string }[] = [
    { phase: "idle", label: t("common.cancel") },
    { phase: "thinking", label: t("mobile.chat.activity.thinking") },
    { phase: "generating", label: t("mobile.chat.activity.responding") },
    { phase: "tool", label: sourceText("Working through the next tool-assisted step…") },
    { phase: "done", label: t("common.done") },
  ];
  if (!__DEV__) return <Redirect href="/connected" />;
  return (
    <>
      <Stack.Screen options={{ title: t("mobile.settings.animations.title"), headerTransparent: false }} />
      <ScrollView
        className="flex-1 bg-team-canvas"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 24, gap: 24, paddingBottom: 50 }}
      >
        <View className="flex-row items-center justify-between">
          <SettingsSwitch
            value={animate}
            disabled={false}
            dark={theme === "dark"}
            onValueChange={setAnimate}
            label={t("mobile.settings.animations.agentFaces")}
          />
        </View>
        <View className="flex-row flex-wrap gap-2">
          {choices.map((choice) => (
            <Button
              key={choice.phase}
              variant={phase === choice.phase ? "primary" : "secondary"}
              onPress={() => {
                setPhase(choice.phase);
                if (choice.phase === "done") setReplay((value) => value + 1);
              }}
            >
              <Button.Label>{choice.label}</Button.Label>
            </Button>
          ))}
        </View>
        <SynchronizedChatPreview phase={phase} animate={animate} showReply={params.reply === "1"} />
        {SIZES.map((size) => (
          <View
            key={size}
            className="flex-row items-center gap-8"
            style={{ minHeight: size * 1.8, paddingHorizontal: 30 }}
          >
            <BloubAvatarPreview
              key={replay}
              seed="jarvis"
              hue={150}
              size={size}
              rings
              animateIdle={false}
              activityPhase={phase}
              activityMotion={animate}
            />
            <Typography.Paragraph className="text-muted">{size}</Typography.Paragraph>
          </View>
        ))}
        <View className="flex-row items-center justify-between" style={{ paddingHorizontal: 8, paddingVertical: 20 }}>
          {SEEDS.map((seed, index) => (
            <BloubAvatarPreview
              key={seed}
              seed={seed}
              hue={AVATAR_HUES[index] ?? null}
              size={24}
              rings
              animateIdle={false}
              activityPhase={phase}
              activityMotion={animate}
            />
          ))}
        </View>
      </ScrollView>
    </>
  );
}
