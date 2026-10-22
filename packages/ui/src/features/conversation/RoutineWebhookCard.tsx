import { Webhook } from "@openbot/ui";
import { useText } from "../../text";
import { ChatActionCard } from "./ChatActionCard";
import { RoutineWebhookEndpoint, type RoutineWebhookEndpointProps } from "./RoutineWebhookEndpoint";

export interface RoutineWebhookCardProps extends RoutineWebhookEndpointProps {
  routineName: string;
  onOpenRoutine?: (() => void) | undefined;
}

/**
 * The chat record of a webhook routine an agent created. The agent never gets the signing
 * secret, so the person makes one here and copies it with the URL.
 */
export function RoutineWebhookCard(props: RoutineWebhookCardProps) {
  const { t } = useText();
  return (
    <ChatActionCard
      class="routine-webhook-card"
      icon={<Webhook />}
      eyebrow={t("routine.card.webhookCreated")}
      title={props.routineName}
      onOpen={props.onOpenRoutine}
      openLabel={t("routine.card.open", { name: props.routineName })}
      status={props.secret ? undefined : { kind: "note", text: t("routine.card.webhookSecretNote") }}
    >
      <div class="routine-webhook-card-endpoint">
        <RoutineWebhookEndpoint
          url={props.url}
          connected={props.connected}
          secret={props.secret}
          onSecretDismiss={props.onSecretDismiss}
          onRegenerateSecret={props.onRegenerateSecret}
        />
      </div>
    </ChatActionCard>
  );
}
