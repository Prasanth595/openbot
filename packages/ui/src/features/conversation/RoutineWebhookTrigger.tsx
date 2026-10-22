import type { EventFilterDraft } from "@openbot/contracts/event-filter-value";
import { Text, Webhook } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";
import { RoutineWebhookEndpoint } from "./RoutineWebhookEndpoint";
import { RoutineWebhookEvents } from "./RoutineWebhookEvents";

export interface RoutineWebhookTriggerProps {
  /** The URL the host made. Null until the relay registers the route. */
  url: string | null;
  /** True when the saved routine has a webhook trigger, so a URL and a secret exist. */
  saved: boolean;
  /** The relay connection of the host. Null when it is not known. */
  connected: boolean | null;
  eventType: string;
  filters: EventFilterDraft[];
  onEventTypeChange: (eventType: string) => void;
  onFiltersChange: (filters: EventFilterDraft[]) => void;
  /** The signing secret that the host returned once. Null when there is nothing to show. */
  secret: string | null;
  onSecretDismiss: () => void;
  /** Makes a new secret. The parent shows it through `secret`. */
  onRegenerateSecret: () => Promise<void>;
  /** A control at the end of the header, such as the menu that changes the trigger. */
  menu?: JSX.Element;
}

/**
 * The webhook trigger as one card: what starts the routine, the endpoint, the signing secret
 * and the events that start it. Each value has one action beside it.
 */
export function RoutineWebhookTrigger(props: RoutineWebhookTriggerProps) {
  const { t } = useText();
  return (
    <div class="routine-trigger-card">
      <div class="routine-trigger-card-header">
        <span class="routine-trigger-icon" aria-hidden="true">
          <Webhook />
        </span>
        <span class="routine-trigger-card-title">{t("routine.trigger.webhookDescription")}</span>
        <span class="routine-trigger-action">{props.menu}</span>
      </div>

      <Show
        when={props.saved}
        fallback={
          <Text variant="caption" tone="muted" class="routine-webhook-note">
            {t("routine.webhook.urlAfterSave")}
          </Text>
        }
      >
        <RoutineWebhookEndpoint
          url={props.url}
          connected={props.connected}
          secret={props.secret}
          onSecretDismiss={props.onSecretDismiss}
          onRegenerateSecret={props.onRegenerateSecret}
        />
      </Show>

      <RoutineWebhookEvents
        eventType={props.eventType}
        filters={props.filters}
        onEventTypeChange={props.onEventTypeChange}
        onFiltersChange={props.onFiltersChange}
      />
    </div>
  );
}
