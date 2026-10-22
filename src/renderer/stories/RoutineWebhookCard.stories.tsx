import { RoutineWebhookCard, type RoutineWebhookCardProps } from "@openbot/ui/features/conversation/RoutineWebhookCard";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * The chat record of a webhook routine an agent created. The agent never gets the signing secret,
 * so the person makes one on the card. In the app, `RoutineWebhookChatCard` asks the host for it.
 */

const STORY_SECRET = "whsec_storybook-example-not-a-real-secret";

/** Holds the secret, so Regenerate shows it the way the host's answer does. */
function CardStage(props: RoutineWebhookCardProps) {
  const [secret, setSecret] = createSignal<string | null>(null);
  return (
    <RoutineWebhookCard
      {...props}
      secret={secret() ?? props.secret}
      onSecretDismiss={() => {
        setSecret(null);
        props.onSecretDismiss();
      }}
      onRegenerateSecret={async () => {
        await props.onRegenerateSecret();
        setSecret(STORY_SECRET);
      }}
    />
  );
}

const meta = {
  title: "Routines/Webhook card",
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <CardStage {...args} />
    </main>
  ),
  args: {
    routineName: "Triage new GitHub issues",
    url: "https://signal.openbot.run/v1/webhooks/0f3c9d2e-4b1a-4c55-9a87-2f6d1e0b7c34",
    connected: true,
    secret: null,
    onSecretDismiss: fn(),
    onRegenerateSecret: fn(async () => undefined),
    onOpenRoutine: fn(),
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<RoutineWebhookCardProps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Created: Story = {};

export const SecretShown: Story = {
  args: { secret: STORY_SECRET },
};

export const UrlPending: Story = {
  args: { url: null, connected: null },
};

export const RelayOffline: Story = {
  args: { connected: false },
};
