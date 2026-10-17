import type { BrowserControlSession, BrowserTab } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import type { JSX } from "@solidjs/web";
import type { BrowserViewRuntime } from "./BrowserLiveView";
import type { BrowserHistoryEntry } from "./browser-suggestions";
import type { BrowserShortcutPlatform } from "./browser-view-shortcuts";

export interface BrowserFullViewProps {
  open: boolean;
  /** Every tab, in the order of the top row. */
  tabs: readonly BrowserTab[];
  activeTab: BrowserTab | undefined;
  /** The pages of this session, the most recent first, for the address suggestions. */
  history: readonly BrowserHistoryEntry[];
  /** Whether a closed tab can open again. */
  canReopen: boolean;
  controlForTab: (tab: BrowserTab) => BrowserControlSession | undefined;
  /** The agent that controls the tab now. */
  controllerForTab: (tab: BrowserTab) => AgentProfile | undefined;
  /** The agent that opened the tab, or undefined for a tab of the user. */
  ownerForTab: (tab: BrowserTab) => AgentProfile | undefined;
  onActivateTab: (tabId: string) => void;
  onCloseTabs: (tabIds: readonly string[]) => void;
  /** Opens a new tab after `afterId`, or at the end. The address field gets the focus when it resolves. */
  onNewTab: (afterId?: string) => Promise<unknown>;
  onDuplicateTab: (tabId: string) => void;
  /** Moves the tab so that it ends at `index`. */
  onMoveTab: (tabId: string, index: number) => void;
  onReopenTab: () => void;
  onReload: (tabId: string) => void;
  onNavigate: (tabId: string, direction: "back" | "forward") => void;
  /** Opens the address in the tab, or in a new tab when there is none. */
  onOpenAddress: (url: string, tabId: string | undefined) => void;
  onSurface: (element: HTMLDivElement | undefined) => void;
  /** The tab to draw here, for a host whose browser is not a view on this screen. Local: `null`. */
  liveViewTabId: string | null;
  liveViewRuntime: BrowserViewRuntime;
  /** Whether the host pastes and copies for the live view. */
  liveViewClipboard: boolean;
  canCloseTabs?: boolean;
  /** False where the page cannot leave the window, such as the web app. */
  canEnterPip?: boolean;
  onBack: () => void;
  onEnterPip: () => void;
  /**
   * Whether the window draws the macOS traffic lights over this view. The view is portaled to
   * `document.body`, so it cannot read the platform class of `.app-frame`.
   */
  macWindowControls?: boolean;
  /**
   * The keys of other browsers work in the view, as on this platform. The web client leaves them to the
   * user's browser, so it gives no platform.
   */
  shortcuts?: BrowserShortcutPlatform;
  /** The island, the queue and the composer of the tab's agent, over the page. */
  dock?: JSX.Element;
}
