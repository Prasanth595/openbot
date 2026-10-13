import type { ServerSummary } from "@openbot/contracts/ipc";
import { Alert, AlertContent, AlertDescription, AlertDialog, AlertIcon, Button, Spinner, toast } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { CircleCheck, CircleDot, RotateCcw, TriangleAlert } from "../../icons";
import { useText } from "../../text";

type RestartServer = Pick<ServerSummary, "id" | "name" | "state" | "hostedIssue">;
type RestartPhase = "confirm" | "stopping" | "starting" | "online" | "failed";
type StepStatus = "done" | "active" | "failed" | "pending";

const STEPS = [
  { label: "server.settings.restartStepStop", detail: "server.settings.restartStepStopDetail" },
  { label: "server.settings.restartStepStart", detail: "server.settings.restartStepStartDetail" },
] as const;

/**
 * Asks before the owner restarts a hosted server, then shows the restart until the server is online
 * again or does not start. A failed request stays in the dialog. The owner can hide the dialog while
 * the server restarts; a toast then reports the result.
 */
export function RestartServerDialog(props: {
  /** The server to restart. Null closes the dialog. */
  server: RestartServer | null;
  /** The current servers. A hidden restart follows its server here after `server` is null. */
  servers: readonly RestartServer[];
  onClose: () => void;
  onRestart: () => Promise<void>;
  /** The element that opened the dialog. A menu item is gone when the dialog closes. */
  restoreFocusTarget?: HTMLElement | null | undefined;
}) {
  const { t, errorMessage } = useText();
  const [phase, setPhase] = createSignal<RestartPhase>("confirm");
  const [error, setError] = createSignal<string | null>(null);
  const [elapsed, setElapsed] = createSignal(0);
  const [restartId, setRestartId] = createSignal<string | null>(null);
  let requestDone = false;
  let wentDown = false;
  let lastIssue: RestartServer["hostedIssue"] = null;
  let clock: ReturnType<typeof setInterval> | undefined;
  let cancelButton: HTMLButtonElement | undefined;
  let primaryButton: HTMLButtonElement | undefined;
  let opener: HTMLElement | undefined;
  let restoreFrame: number | undefined;

  const restarting = () => phase() === "stopping" || phase() === "starting";
  const restartServer = () => props.servers.find((server) => server.id === restartId()) ?? null;
  const name = () => props.server?.name ?? restartServer()?.name ?? "";
  const toastId = () => `restart-server-${restartId() ?? ""}`;

  function stopClock(): void {
    if (clock !== undefined) clearInterval(clock);
    clock = undefined;
  }
  onCleanup(() => {
    stopClock();
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
  });

  function reset(): void {
    stopClock();
    setRestartId(null);
    setPhase("confirm");
    setError(null);
    setElapsed(0);
  }

  // A new request opens the confirmation. A request for the server that restarts shows its progress.
  createEffect(
    () => props.server?.id ?? null,
    (id) => {
      if (id === null || untrack(() => id === restartId() && restarting())) return;
      reset();
    },
  );

  function finish(result: "online" | "failed"): void {
    stopClock();
    setPhase(result);
    if (props.server) {
      queueMicrotask(() => primaryButton?.focus({ preventScroll: true }));
      return;
    }
    // The dialog is hidden, so the toast that it opened reports the result.
    const title =
      result === "online"
        ? t("server.settings.restartDoneTitle", { name: name() })
        : t("server.settings.restartFailedTitle", { name: name() });
    if (result === "online") toast.success(title, { id: toastId(), description: undefined });
    else toast.error(title, { id: toastId(), description: failedDescription() });
    reset();
  }

  /** The server goes offline when it stops, and comes back online when it starts again. */
  function follow(server: Pick<RestartServer, "state" | "hostedIssue"> | null): void {
    if (!requestDone || !restarting() || !server) return;
    const issue = server.hostedIssue ?? null;
    if (issue !== null && issue !== lastIssue) {
      finish("failed");
      return;
    }
    lastIssue = issue;
    if (server.state !== "online") {
      wentDown = true;
      if (phase() === "stopping") setPhase("starting");
    } else if (wentDown) finish("online");
  }

  createEffect(
    () => {
      const server = restartServer();
      return server ? { state: server.state, hostedIssue: server.hostedIssue ?? null } : null;
    },
    (server) => untrack(() => follow(server)),
  );

  async function restart(): Promise<void> {
    const server = props.server;
    if (!server || restarting()) return;
    stopClock();
    requestDone = false;
    wentDown = false;
    setRestartId(server.id);
    setError(null);
    setElapsed(0);
    setPhase("stopping");
    clock = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    try {
      await props.onRestart();
    } catch (failure) {
      const message = errorMessage(failure, t("server.settings.actionFailed"));
      if (!props.server) {
        toast.error(t("server.settings.restartFailedTitle", { name: name() }), { id: toastId(), description: message });
        reset();
        return;
      }
      stopClock();
      setPhase("confirm");
      setError(message);
      return;
    }
    requestDone = true;
    // An issue from before the restart is not its result. A new issue, or the same issue after it
    // cleared, is.
    lastIssue = restartServer()?.hostedIssue ?? null;
    follow(restartServer());
  }

  function close(): void {
    if (restarting()) {
      toast.loading(t("server.settings.restartedTitle", { name: name() }), {
        id: toastId(),
        description: t("server.settings.restartHiddenDescription"),
      });
    } else reset();
    props.onClose();
  }

  const failedDescription = () =>
    restartServer()?.hostedIssue === "plan_ended"
      ? t("server.connection.planEnded", { name: name() })
      : t("server.settings.restartFailedDescription");

  const title = () => {
    switch (phase()) {
      case "confirm":
        return t("server.settings.restartConfirmTitle", { name: name() });
      case "online":
        return t("server.settings.restartDoneTitle", { name: name() });
      case "failed":
        return t("server.settings.restartFailedTitle", { name: name() });
      default:
        return t("server.settings.restartProgressTitle", { name: name() });
    }
  };
  const description = () => {
    switch (phase()) {
      case "confirm":
        return t("server.settings.restartConfirmDescription");
      case "online":
        return t("server.settings.restartDoneDescription", { time: formatElapsed(elapsed()) });
      case "failed":
        return failedDescription();
      default:
        return t("server.settings.restartProgressDescription", { time: formatElapsed(elapsed()) });
    }
  };
  const stepStatus = (index: number): StepStatus => {
    switch (phase()) {
      case "online":
        return "done";
      case "failed":
        return index === 0 ? "done" : "failed";
      case "stopping":
        return index === 0 ? "active" : "pending";
      default:
        return index === 0 ? "done" : "active";
    }
  };
  const secondaryLabel = () => (phase() === "confirm" ? t("common.cancel") : t("common.close"));
  const primaryLabel = () => {
    if (phase() === "online") return t("common.done");
    if (phase() === "failed") return t("common.tryAgain");
    return t("server.settings.restartTitle");
  };

  return (
    <AlertDialog.Root
      open={props.server !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay class="ui-confirm-dialog-overlay">
          <AlertDialog.Content
            class="ui-confirm-dialog restart-server-dialog"
            data-tone="default"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              const active = document.activeElement;
              opener = active instanceof HTMLElement && active !== document.body ? active : undefined;
              (restarting() || phase() === "confirm" ? cancelButton : primaryButton)?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event) => {
              const target = props.restoreFocusTarget ?? opener;
              if (!target?.isConnected) return;
              event.preventDefault();
              target.focus({ preventScroll: true });
              // The enclosing dialog resumes its focus trap after this one closes.
              restoreFrame = requestAnimationFrame(() => {
                restoreFrame = requestAnimationFrame(() => {
                  if (props.server === null && target.isConnected) target.focus({ preventScroll: true });
                });
              });
            }}
          >
            <div class="ui-confirm-dialog-main">
              <span class="ui-confirm-dialog-icon" aria-hidden="true">
                <Show when={phase() === "failed"} fallback={<RotateCcw />}>
                  <TriangleAlert />
                </Show>
              </span>
              <div class="ui-confirm-dialog-content">
                <AlertDialog.Title as="h2" class="ui-confirm-dialog-title">
                  {title()}
                </AlertDialog.Title>
                <AlertDialog.Description class="ui-confirm-dialog-description">{description()}</AlertDialog.Description>
                <Show when={phase() !== "confirm"}>
                  <div class="ui-confirm-dialog-body">
                    <ol class="restart-server-steps" aria-label={t("server.settings.restartSteps")}>
                      <For each={STEPS}>
                        {(step, index) => (
                          <li
                            class="restart-server-step"
                            data-status={stepStatus(index())}
                            aria-current={stepStatus(index()) === "active" ? "step" : undefined}
                          >
                            <span class="restart-server-step-icon" aria-hidden="true">
                              <StepIcon status={stepStatus(index())} />
                            </span>
                            <span class="restart-server-step-text">
                              <span class="restart-server-step-label">{t(step.label)}</span>
                              <span class="restart-server-step-detail">{t(step.detail)}</span>
                            </span>
                          </li>
                        )}
                      </For>
                    </ol>
                  </div>
                </Show>
                <Show when={error()}>
                  <Alert tone="danger" report={false} role="alert" class="ui-confirm-dialog-error">
                    <AlertIcon>
                      <TriangleAlert />
                    </AlertIcon>
                    <AlertContent>
                      <AlertDescription>{error()}</AlertDescription>
                    </AlertContent>
                  </Alert>
                </Show>
              </div>
            </div>
            <footer class="ui-confirm-dialog-actions">
              <Show when={phase() !== "online"}>
                <Button
                  ref={(element: HTMLButtonElement) => {
                    cancelButton = element;
                  }}
                  variant="ghost"
                  type="button"
                  onClick={() => close()}
                >
                  <Show when={restarting()} fallback={secondaryLabel()}>
                    {t("server.settings.restartHide")}
                  </Show>
                </Button>
              </Show>
              <Button
                ref={(element: HTMLButtonElement) => {
                  primaryButton = element;
                }}
                type="button"
                class="ui-confirm-dialog-confirm"
                loading={restarting()}
                loadingLabel={t("server.settings.restarting")}
                onClick={() => {
                  if (phase() === "online") close();
                  else void restart();
                }}
              >
                {primaryLabel()}
              </Button>
            </footer>
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function StepIcon(props: { status: StepStatus }): JSX.Element {
  return (
    <Show when={props.status !== "active"} fallback={<Spinner />}>
      <Show when={props.status !== "done"} fallback={<CircleCheck />}>
        <Show when={props.status === "failed"} fallback={<CircleDot />}>
          <TriangleAlert />
        </Show>
      </Show>
    </Show>
  );
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
