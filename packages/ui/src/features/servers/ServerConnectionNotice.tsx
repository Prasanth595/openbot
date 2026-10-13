import type { HostedServerIssue } from "@openbot/contracts/ipc";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import { Button } from "../../button";
import { ErrorReference } from "../../error-reference";
import { useText } from "../../text";
import { AppLoadingScreen } from "../account/AppLoadingScreen";

export type ServerWorkspacePhase =
  | "connecting"
  | "loading"
  | "reconnecting"
  | "waiting"
  | "sleeping"
  | "waking"
  | "blocked";

export interface ServerConnectionNoticeProps {
  name: string;
  phase: ServerWorkspacePhase;
  initial: boolean;
  issue?: HostedServerIssue | null;
  remainingSeconds?: number;
  busy?: boolean;
  detail?: string | null;
  /** The code of the failure in `detail`, for a user to copy into a report. */
  reference?: string | null;
  onRetry: () => void;
  onManage?: () => void;
}

/** Connection feedback stays visible until the workspace can answer the user's actions. */
export function ServerConnectionNotice(props: ServerConnectionNoticeProps) {
  const { t } = useText();
  const title = () => {
    switch (props.issue) {
      case "plan_ended":
        return t("server.connection.planEnded", { name: props.name });
      case "wake_failed":
        return t("server.connection.wakeFailed", { name: props.name });
      case "start_timeout":
        return t("server.connection.startTimeout", { name: props.name });
    }
    switch (props.phase) {
      case "sleeping":
        return t("server.connection.sleeping", { name: props.name });
      case "waking":
        return t("server.connection.waking", { name: props.name });
      case "loading":
        return t("server.connection.loading", { name: props.name });
      case "connecting":
        return t("server.connection.connecting", { name: props.name });
      case "blocked":
        return t("server.connection.blocked", { name: props.name });
      default:
        return t("server.connection.reconnecting", { name: props.name });
    }
  };
  const detail = () =>
    props.detail ??
    (props.remainingSeconds
      ? t("server.connection.nextRetry", { seconds: props.remainingSeconds })
      : props.phase === "sleeping"
        ? t("server.connection.wakeHint")
        : props.issue === "plan_ended"
          ? t("server.connection.planHint")
          : props.initial
            ? t("server.connection.loadingHint")
            : t("server.connection.cachedHint"));
  const actions = () => (
    <>
      <Button variant="outline" disabled={props.busy} onClick={() => props.onRetry()}>
        {t("server.connection.retry")}
      </Button>
      <Show when={props.onManage && (props.issue === "plan_ended" || props.phase === "blocked")}>
        <Button variant="outline" onClick={() => props.onManage?.()}>
          {t("server.connection.manage")}
        </Button>
      </Show>
    </>
  );
  return (
    <Show
      when={props.initial}
      fallback={
        <section class="server-connection-notice" role="status" aria-live="polite">
          <div>
            <p>{title()}</p>
            <p class="server-connection-detail">{detail()}</p>
            <ErrorReference reference={props.reference} />
          </div>
          <div class="server-connection-actions">{actions()}</div>
        </section>
      }
    >
      <AppLoadingScreen
        label={title()}
        title={title()}
        detail={detail()}
        reference={props.reference ?? null}
        actions={actions()}
      />
    </Show>
  );
}

// A history that loads faster than this does not cover the chat, so a fast switch does not flash.
const CONVERSATION_LOADING_DELAY_MS = 150;

export interface ConversationLoadNoticeProps {
  /** The agent whose history loads. */
  name: string;
  /** The first page of the history is loading. */
  loading: boolean;
  /** Why the history did not load. The notice then shows Retry. */
  error: string | null;
  onRetry: () => void;
}

/**
 * While an agent's history loads for the first time, the crew of the app loading screen covers the
 * chat, and jumps out when the history is ready. A failed load shows the notice with Retry.
 */
export function ConversationLoadNotice(props: ConversationLoadNoticeProps) {
  const { t } = useText();
  const waiting = () => props.loading && !props.error;
  // Each wait gets its own screen: a screen that started its exit cannot load again.
  const [screen, setScreen] = createSignal<number | null>(null);
  // The screen that started its exit. It stays ready, so a new wait does not stop its exit.
  const [exiting, setExiting] = createSignal<number | null>(null);
  let screens = 0;
  createEffect(waiting, (current) => {
    if (!current) {
      setExiting(untrack(screen));
      return;
    }
    const timer = setTimeout(() => {
      screens += 1;
      setScreen(screens);
    }, CONVERSATION_LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  });
  return (
    <>
      <Show when={screen()} keyed>
        {(key) => (
          <AppLoadingScreen
            ready={key === exiting() || !waiting()}
            label={t("server.connection.loading", { name: props.name })}
            title={t("server.connection.loading", { name: props.name })}
            onExited={() => setScreen((current) => (current === key ? null : current))}
          />
        )}
      </Show>
      <Show when={props.error}>
        {(error) => (
          <ServerConnectionNotice
            name={props.name}
            phase="blocked"
            initial={false}
            detail={error()}
            onRetry={props.onRetry}
          />
        )}
      </Show>
    </>
  );
}

/** A failed optional read does not prevent work in the loaded workspace. */
export function ServerPanelLoadNotice(props: { busy: boolean; onRetry: () => void }) {
  const { t } = useText();
  return (
    <section class="server-connection-notice" role="status">
      <p>{t("server.connection.panelsFailed")}</p>
      <Button variant="outline" disabled={props.busy} onClick={() => props.onRetry()}>
        {t("server.connection.retry")}
      </Button>
    </section>
  );
}
