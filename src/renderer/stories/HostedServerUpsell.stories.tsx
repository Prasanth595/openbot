import { HostedServerUpsellDialog } from "@openbot/ui/features/servers/HostedServerUpsellDialog";
import { HostedServerUpsellNotice } from "@openbot/ui/features/servers/HostedServerUpsellNotice";
import { ServerConnectionNotice } from "@openbot/ui/features/servers/ServerConnectionNotice";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * The offer of a hosted server, where routines depend on a computer that can be off: a modal after
 * a new routine, a notice above the routine list, and a line in the offline notice of a remote computer.
 */
const meta = {
  title: "Servers/Hosted server upsell",
  parameters: {
    a11y: { test: "error" },
    viewport: {
      options: {
        upsellPhone: { name: "Phone — 390 × 844", styles: { width: "390px", height: "844px" } },
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** After a routine is made on this computer. */
export const ModalThisComputer: Story = {
  render: () => (
    <HostedServerUpsellDialog
      routine={{ name: "Morning brief", schedule: "Every weekday at 08:00" }}
      host="this-computer"
      onSeePlans={fn()}
      onClose={fn()}
    />
  ),
};

/** After a routine is made on the user's own remote computer. */
export const ModalRemoteComputer: Story = {
  render: () => (
    <HostedServerUpsellDialog
      routine={{ name: "Inbox triage", schedule: "Every hour" }}
      host={{ name: "Studio Mac" }}
      onSeePlans={fn()}
      onClose={fn()}
    />
  ),
};

/** The web client at phone width. */
export const ModalWebNarrow: Story = {
  globals: { viewport: { value: "upsellPhone", isRotated: false } },
  render: () => (
    <HostedServerUpsellDialog
      routine={{ name: "Morning brief", schedule: "Every weekday at 08:00" }}
      host={{ name: "Studio Mac" }}
      onSeePlans={fn()}
      onClose={fn()}
    />
  ),
};

/** Above the routine list, with active routines on this computer. */
export const NoticeThisComputer: Story = {
  render: () => <HostedServerUpsellNotice count={3} host="this-computer" onSeePlans={fn()} onDismiss={fn()} />,
};

/** Above the routine list of a remote computer, with one active routine. */
export const NoticeRemoteComputer: Story = {
  render: () => <HostedServerUpsellNotice count={1} host={{ name: "Studio Mac" }} onSeePlans={fn()} onDismiss={fn()} />,
};

/** The remote computer is offline, and the account has no hosted server. */
export const OfflineNotice: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <ServerConnectionNotice
      name="Studio Mac"
      phase="waiting"
      initial
      remainingSeconds={20}
      onRetry={fn()}
      upsell={{ onSeePlans: fn() }}
    />
  ),
};

/** The same offline notice after the workspace loaded once. */
export const OfflineNoticeCompact: Story = {
  render: () => (
    <ServerConnectionNotice
      name="Studio Mac"
      phase="waiting"
      initial={false}
      remainingSeconds={20}
      onRetry={fn()}
      upsell={{ onSeePlans: fn() }}
    />
  ),
};
