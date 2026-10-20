import { Button, Dialog, IconButton, Moon, Server, X } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { HostedUpsellBeamGlow } from "./HostedServerUpsellNotice";
import type { HostedUpsellHost } from "./hosted-server-upsell-host";

export interface HostedServerUpsellDialogProps {
  routine: { name: string; schedule?: string | undefined };
  host: HostedUpsellHost;
  onSeePlans: () => void;
  onClose: () => void;
}

/** The offer of a hosted server after a new routine. It names the routine that stops with the computer. */
export function HostedServerUpsellDialog(props: HostedServerUpsellDialogProps) {
  const { t } = useText();
  let seePlans: HTMLButtonElement | undefined;
  const description = () => {
    const host = props.host;
    return host === "this-computer"
      ? t("server.upsell.modal.description.local")
      : t("server.upsell.modal.description.remote", { server: host.name });
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content
            as="section"
            class="hosted-upsell-modal hosted-upsell-beam"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              seePlans?.focus({ preventScroll: true });
            }}
          >
            <HostedUpsellBeamGlow />
            <IconButton
              class="hosted-upsell-modal-close"
              label={t("common.close")}
              variant="ghost"
              onClick={() => props.onClose()}
            >
              <X />
            </IconButton>
            <span class="hosted-upsell-modal-icon" aria-hidden="true">
              <Server />
            </span>
            <Dialog.Title as="h2" class="hosted-upsell-modal-title">
              {t("server.upsell.modal.title", { name: props.routine.name })}
            </Dialog.Title>
            <Dialog.Description as="p" class="hosted-upsell-modal-description">
              {description()}
            </Dialog.Description>
            <div class="hosted-upsell-modal-routine">
              <Moon aria-hidden="true" />
              <span>{props.routine.name}</span>
              <Show when={props.routine.schedule}>{(schedule) => <span>{schedule()}</span>}</Show>
            </div>
            <footer class="hosted-upsell-modal-actions">
              <Button variant="ghost" onClick={() => props.onClose()}>
                {t("server.upsell.notNow")}
              </Button>
              <Button ref={(element) => (seePlans = element)} onClick={() => props.onSeePlans()}>
                {t("server.upsell.seePlans")}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
