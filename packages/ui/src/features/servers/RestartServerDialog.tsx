import type { ServerSummary } from "@openbot/contracts/ipc";
import { ConfirmDialog, toast } from "@openbot/ui";
import { createEffect, createSignal } from "solid-js";
import { useText } from "../../text";

/**
 * Asks before the owner restarts a hosted server. A failed restart stays in the dialog. The dialog
 * closes when `onRestart` resolves.
 */
export function RestartServerDialog(props: {
  server: Pick<ServerSummary, "name"> | null;
  onClose: () => void;
  onRestart: () => Promise<void>;
  /** The element that opened the dialog. A menu item is gone when the dialog closes. */
  restoreFocusTarget?: HTMLElement | null | undefined;
}) {
  const { t, errorMessage } = useText();
  const [error, setError] = createSignal<string | null>(null);
  createEffect(
    () => props.server !== null,
    (open) => {
      if (open) setError(null);
    },
  );
  function close(): void {
    setError(null);
    props.onClose();
  }
  return (
    <ConfirmDialog
      open={props.server !== null}
      tone="default"
      initialFocus="cancel"
      restoreFocusTarget={props.restoreFocusTarget}
      title={t("server.settings.restartConfirmTitle", { name: props.server?.name ?? "" })}
      description={t("server.settings.restartConfirmDescription")}
      confirmLabel={t("server.settings.restartTitle")}
      pendingLabel={t("server.settings.restarting")}
      error={error() ?? undefined}
      onCancel={close}
      onConfirm={async () => {
        const name = props.server?.name ?? "";
        setError(null);
        try {
          await props.onRestart();
        } catch (failure) {
          setError(errorMessage(failure, t("server.settings.actionFailed")));
          return;
        }
        close();
        toast.success(t("server.settings.restartedTitle", { name }));
      }}
    />
  );
}
