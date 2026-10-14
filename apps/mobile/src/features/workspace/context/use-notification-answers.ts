import type { AgentEvent, RespondToApprovalInput, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { useCallback, useEffect, useRef, useState } from "react";
import { notificationActionsNative as native } from "@/features/push-notifications/notification-actions";
import { answersApproval, type NotificationApprovalAnswer } from "@/features/push-notifications/notification-approvals";
import { useAppLanguage } from "@/features/settings/model/app-language";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { InactiveRequestError, type PendingApproval } from "@/features/workspace/model/pending-approvals";
import { currentText, useText } from "@/shared/lib/text";

/** iOS gives the app about 30 seconds in the background. The failure notice needs the rest. */
const ANSWER_DEADLINE_MS = 25_000;

interface NotificationAnswersInput {
  /** Whether the server is connected now, with the app on screen, so its approvals are current. */
  connectedNow(serverId: string): boolean;
  pendingApprovals(serverId: string): readonly PendingApproval[];
  send(serverId: string, input: RespondToApprovalInput): Promise<void>;
}

export interface NotificationAnswers {
  /** The servers that connect for an answer, also while the app is in the background. */
  answeringServerIds: readonly string[];
  /** The connection of the server finished loading. */
  serverOnline(serverId: string): void;
  /** The workspace applied an event of the server. */
  teamEvent(serverId: string, event: AgentEvent | TeamRealtimeEvent): void;
}

type Signal = { type: "online" } | { type: "event"; complete: boolean; summary: string };

/**
 * Answers the Allow and Deny buttons of approval notifications, also from a paired Apple Watch. iOS
 * starts or wakes the app in the background. The app connects to the server of the notification,
 * waits for the request that the notification names, and sends the answer. When it cannot, it tells
 * the user with a notification that opens the chat.
 */
export function useNotificationAnswers(input: NotificationAnswersInput): NotificationAnswers {
  const inputRef = useRef(input);
  inputRef.current = input;
  const { t } = useText();
  const [answeringServerIds, setAnsweringServerIds] = useState<readonly string[]>([]);
  const listeners = useRef(new Set<(serverId: string, signal: Signal) => void>());

  const signal = useCallback((serverId: string, value: Signal) => {
    for (const listener of listeners.current) listener(serverId, value);
  }, []);
  const serverOnline = useCallback((serverId: string) => signal(serverId, { type: "online" }), [signal]);
  const teamEvent = useCallback(
    (serverId: string, event: AgentEvent | TeamRealtimeEvent) =>
      signal(serverId, {
        type: "event",
        complete: event.type === "runtime-snapshot" && event.snapshot.attentionComplete,
        summary:
          event.type === "runtime-snapshot"
            ? `runtime-snapshot complete ${event.snapshot.attentionComplete}, approvals ${event.snapshot.pendingApprovals.map((approval) => `${approval.agentId}/${approval.requestId}/${approval.turnId}`).join(" ") || "none"}`
            : event.type === "approval"
              ? `approval ${event.approval.agentId}/${event.approval.requestId}/${event.approval.turnId}`
              : event.type,
      }),
    [signal],
  );

  /** `found` when the host waits on the request, `gone` when it does not, `timeout` without an answer. */
  const waitForRequest = useCallback(
    (answer: NotificationApprovalAnswer) =>
      new Promise<"found" | "gone" | "timeout">((resolve) => {
        const { serverId } = answer;
        let online = inputRef.current.connectedNow(serverId);
        // A whole snapshot of this connection without the request means that it is answered or over.
        let complete = online;
        const check = () => {
          if (!online) return;
          if (inputRef.current.pendingApprovals(serverId).some((approval) => answersApproval(approval, answer))) {
            finish("found");
          } else if (complete) {
            finish("gone");
          }
        };
        const listener = (id: string, value: Signal) => {
          if (id !== serverId) return;
          supportLog.add(
            "info",
            "app",
            `notification answer heard ${value.type === "online" ? "online" : value.summary}`,
          );
          if (value.type === "online") online = true;
          else complete ||= value.complete;
          check();
        };
        const timer = setTimeout(() => finish("timeout"), ANSWER_DEADLINE_MS);
        const finish = (outcome: "found" | "gone" | "timeout") => {
          clearTimeout(timer);
          listeners.current.delete(listener);
          resolve(outcome);
        };
        listeners.current.add(listener);
        check();
      }),
    [],
  );

  const answer = useCallback(
    async (value: NotificationApprovalAnswer) => {
      if (!native) return;
      const release = await native.holdBackgroundTime();
      const request = `${value.serverId} agent ${value.agentId} chat ${value.threadId} request ${value.requestId} turn ${value.turnId}`;
      supportLog.add("info", "app", `notification ${value.decision}: ${request}`);
      setAnsweringServerIds((current) => [...current, value.serverId]);
      try {
        let failed: boolean;
        try {
          const outcome = await waitForRequest(value);
          const pending = inputRef.current
            .pendingApprovals(value.serverId)
            .map((approval) => `${approval.agentId}/${approval.threadId}/${approval.requestId}/${approval.turnId}`);
          supportLog.add(
            "info",
            "app",
            `notification ${value.decision} ${outcome}: ${request}, pending ${pending.join(" ") || "none"}`,
          );
          // `gone`: another device answered the request, or its turn ended.
          if (outcome === "found") {
            await inputRef.current.send(value.serverId, { requestId: value.requestId, decision: value.decision });
          }
          failed = outcome === "timeout";
        } catch (error) {
          supportLog.add("warn", "app", `notification ${value.decision} failed: ${request}: ${supportLogValue(error)}`);
          failed = !(error instanceof InactiveRequestError);
        }
        if (failed) {
          await native
            .showFailure(value, currentText().t("mobile.workspace.notification.answerFailed"))
            .catch(() => undefined);
        }
      } finally {
        setAnsweringServerIds((current) => {
          const index = current.indexOf(value.serverId);
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
        });
        release();
      }
    },
    [waitForRequest],
  );

  // The button titles follow the app language. iOS keeps them after the app stops, so a start in the
  // background, which reads the language only when the user opens the app, keeps the saved titles.
  const languageReady = useAppLanguage((state) => state.ready);
  useEffect(() => {
    if (!languageReady) return;
    void native
      ?.registerCategories({
        approve: t("mobile.workspace.notification.allow"),
        deny: t("mobile.workspace.notification.deny"),
      })
      .catch(() => undefined);
  }, [t, languageReady]);

  useEffect(() => native?.onAnswer((value) => void answer(value)), [answer]);

  return { answeringServerIds, serverOnline, teamEvent };
}
