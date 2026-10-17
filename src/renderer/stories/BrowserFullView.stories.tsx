import type { BrowserControlSession, BrowserLiveViewEvent, BrowserTab } from "@openbot/contracts/ipc";
import { BrowserDock } from "@openbot/ui/features/browser/BrowserDock";
import BrowserFullView from "@openbot/ui/features/browser/BrowserFullView";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { requireFixture, STORY_AGENTS } from "./fixtures";

const chief = requireFixture(STORY_AGENTS[0], "Story agent 0");

const tab: BrowserTab = {
  id: "tab-docs",
  title: "OpenBot documentation",
  url: "https://openbot.run/docs",
  loading: false,
  ownerThreadId: "thread-chief",
  ownerAgentId: chief.id,
};

const tabs: BrowserTab[] = [
  tab,
  { ...tab, id: "tab-changelog", title: "Changelog", url: "https://openbot.run/changelog" },
  { ...tab, id: "tab-pricing", title: "Pricing", url: "https://openbot.run/pricing", loading: true },
  {
    ...tab,
    id: "tab-search",
    title: "browser automation - Google Search",
    url: "https://www.google.com/search?q=browser+automation",
    ownerThreadId: null,
    ownerAgentId: null,
  },
];

const control: BrowserControlSession = {
  id: "browser-session-1",
  threadId: "thread-chief",
  turnId: "turn-1",
  callId: "call-1",
  tabId: tab.id,
  action: "click",
  phase: "acting",
  startedAt: new Date("2026-10-17T09:00:00.000Z").toISOString(),
};

const meta = {
  title: "Conversation/BrowserFullView",
  component: BrowserFullView,
  args: {
    open: true,
    tabs,
    activeTab: tab,
    history: [
      { url: "https://openbot.run/docs", title: "OpenBot documentation", visits: 3 },
      { url: "https://openbot.run/docs/browser", title: "Browser · OpenBot documentation", visits: 1 },
    ],
    canReopen: true,
    controlForTab: () => undefined,
    controllerForTab: () => undefined,
    ownerForTab: (entry) => (entry.ownerAgentId === chief.id ? chief : undefined),
    onActivateTab: fn(),
    onCloseTabs: fn(),
    onNewTab: fn(() => Promise.resolve()),
    onDuplicateTab: fn(),
    onMoveTab: fn(),
    onReopenTab: fn(),
    onReload: fn(),
    onNavigate: fn(),
    onOpenAddress: fn(),
    onSurface: fn(),
    liveViewTabId: null,
    liveViewRuntime: {
      startLiveView: fn(async () => undefined),
      stopLiveView: fn(async () => undefined),
      sendLiveViewInput: fn(async () => undefined),
      onLiveViewEvent: fn(() => () => undefined),
    },
    liveViewClipboard: false,
    shortcuts: "mac",
    onBack: fn(),
    onEnterPip: fn(),
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BrowserFullView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Four tabs: three of the agent, one of the user, one loading. */
export const Tabs: Story = {};

/** On macOS the traffic lights are over the top row, so the tabs start clear of them. */
export const MacWindowControls: Story = { args: { macWindowControls: true } };

/** The agent clicks on the page. Its tab shows that it acts, and the dock shows the step. */
export const AgentActing: Story = {
  args: {
    controlForTab: (entry: BrowserTab) => (entry.id === tab.id ? control : undefined),
    controllerForTab: (entry: BrowserTab) => (entry.id === tab.id ? chief : undefined),
    dock: (
      <BrowserDock
        agent={chief}
        agents={STORY_AGENTS}
        value=""
        working
        deliveries={[]}
        canSteer
        island={{ kind: "activity", control: "agent", label: "Clicking “Sign in”" }}
        onHandoff={fn()}
        onValueChange={fn()}
        onSend={fn()}
        onStop={fn()}
        onSteer={fn()}
        onCancel={fn()}
        onEdit={fn()}
        onCancelEdit={fn()}
        onReorder={fn()}
        onRespondSecret={fn(async () => undefined)}
        onDismissReply={fn()}
        onSelectAgent={fn()}
        onOpenLink={fn()}
      />
    ),
  },
};

/** Recording and diagnostic errors show beside the address. */
export const RecordingWithDiagnosticErrors: Story = {
  args: { activeTab: { ...tab, recording: true, diagnosticErrorCount: 12 } },
};

export const PopupBlocked: Story = {
  args: {
    activeTab: {
      ...tab,
      popupFailure: {
        id: "blocked-popup",
        message: "The browser tab limit was reached. Close a tab, then retry from the page.",
      },
    },
  },
};

/** No tab is open. */
export const Empty: Story = { args: { tabs: [], activeTab: undefined, canReopen: false } };

/** A host that sends one 4:3 frame, drawn in the theme's colors. */
function remoteLiveViewRuntime(): BrowserViewRuntime {
  const listeners = new Set<(event: BrowserLiveViewEvent) => void>();
  return {
    async startLiveView(tabId) {
      const width = 1024;
      const height = 768;
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      const theme = getComputedStyle(document.documentElement);
      if (context) {
        context.fillStyle = theme.getPropertyValue("--openbot-bg-surface");
        context.fillRect(0, 0, width, height);
        context.fillStyle = theme.getPropertyValue("--openbot-text-primary");
        context.font = "48px sans-serif";
        context.fillText("Page on the host", 64, 128);
      }
      const image = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg" })).arrayBuffer());
      for (const listener of listeners) listener({ type: "frame", tabId, sequence: 1, width, height, image });
    },
    stopLiveView: async () => undefined,
    sendLiveViewInput: async () => undefined,
    onLiveViewEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * A remote host's tab, as the web app and a desktop connected to a host show it. The page is a frame of
 * the host's shape, the keys stay with the user's browser, and there is no Picture in Picture.
 */
export const RemoteLiveView: Story = {
  args: {
    liveViewTabId: tab.id,
    liveViewRuntime: remoteLiveViewRuntime(),
    canEnterPip: false,
    shortcuts: undefined,
  },
};
