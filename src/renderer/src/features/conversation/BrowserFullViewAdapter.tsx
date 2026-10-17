import type { BrowserTab } from "@openbot/contracts/ipc";
import BrowserFullView from "@openbot/ui/features/browser/BrowserFullView";
import { BROWSER_NEW_TAB_URL } from "@openbot/ui/features/browser/browser-suggestions";
import { createEffect, createMemo } from "solid-js";
import {
  browserSessionHistory,
  canReopenBrowserTab,
  moveBrowserTab,
  orderedBrowserTabs,
  placeNextBrowserTab,
  recordBrowserTitle,
  recordBrowserVisit,
  rememberClosedBrowserTab,
  syncBrowserTabOrder,
  takeClosedBrowserTab,
} from "../browser/browser-tab-session";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { BrowserDockAdapter } from "./BrowserDockAdapter";
import { conversationPort } from "./conversation-port";
import { useConversationViewScope } from "./conversation-scope";

/**
 * The full browser view of the conversation. The order of the tabs, the closed tabs and the pages of the
 * session stay in this window (`browser-tab-session.ts`); the tabs themselves are main's.
 */
export default function BrowserFullViewAdapter() {
  const {
    props,
    activateBrowserTab,
    activeBrowserTab,
    browserControlForTab,
    browserControllerForTab,
    browserExpandedOpen,
    browserTabs,
    closeBrowserTab,
    navigateBrowserTab,
    openBrowserAddress,
    reloadBrowserTab,
    setActiveRightPanel,
    setBrowserSurfaceElement,
    showBrowserPip,
  } = useConversationViewScope();
  const serverId = () => props.server?.id ?? "";
  const tabs = createMemo(() => orderedBrowserTabs(serverId(), browserTabs()));

  createEffect(
    () => ({ id: serverId(), listed: browserTabs() }),
    ({ id, listed }) => syncBrowserTabOrder(id, listed),
  );

  // A tab that shows a new address is a visit. A new title for the same address only names the page.
  const seen = new Map<string, { url: string; title: string }>();
  createEffect(
    () => ({ id: serverId(), pages: browserTabs().map((tab) => ({ tabId: tab.id, url: tab.url, title: tab.title })) }),
    ({ id, pages }) => {
      for (const page of pages) {
        const previous = seen.get(page.tabId);
        if (previous?.url !== page.url) recordBrowserVisit(id, page.url, page.title);
        else if (previous.title !== page.title) recordBrowserTitle(id, page.url, page.title);
        seen.set(page.tabId, { url: page.url, title: page.title });
      }
      const open = new Set(pages.map((page) => page.tabId));
      for (const tabId of seen.keys()) if (!open.has(tabId)) seen.delete(tabId);
    },
  );

  async function openTab(url: string, placement: { afterId?: string; index?: number }) {
    placeNextBrowserTab(serverId(), placement);
    const tab = await openBrowserAddress(url, true);
    if (!tab) placeNextBrowserTab(serverId(), {});
    return tab;
  }

  function closeTabs(tabIds: readonly string[]) {
    const order = tabs();
    // The tab with the lowest index is the first to open again, so each one goes back to its place.
    const closing = tabIds
      .map((tabId) => ({
        tab: order.find((tab) => tab.id === tabId),
        index: order.findIndex((tab) => tab.id === tabId),
      }))
      .filter((entry): entry is { tab: BrowserTab; index: number } => entry.tab !== undefined)
      .sort((left, right) => right.index - left.index);
    for (const { tab, index } of closing) {
      rememberClosedBrowserTab(serverId(), tab, index);
      void closeBrowserTab(tab.id);
    }
  }

  return (
    <BrowserFullView
      open={browserExpandedOpen()}
      macWindowControls={props.platform === "darwin"}
      shortcuts={props.runtime ? undefined : props.platform === "darwin" ? "mac" : "pc"}
      tabs={tabs()}
      activeTab={activeBrowserTab()}
      history={browserSessionHistory(serverId())}
      canReopen={canReopenBrowserTab(serverId())}
      controlForTab={browserControlForTab}
      controllerForTab={browserControllerForTab}
      ownerForTab={(tab) =>
        tab.ownerAgentId ? props.agents.find((agent) => agent.id === tab.ownerAgentId) : undefined
      }
      onActivateTab={activateBrowserTab}
      onCloseTabs={closeTabs}
      onNewTab={(afterId) => openTab(BROWSER_NEW_TAB_URL, afterId === undefined ? {} : { afterId })}
      onDuplicateTab={(tabId) => {
        const tab = tabs().find((entry) => entry.id === tabId);
        if (tab) void openTab(tab.url, { afterId: tab.id });
      }}
      onMoveTab={(tabId, index) => moveBrowserTab(serverId(), tabs(), tabId, index)}
      onReopenTab={() => {
        const closed = takeClosedBrowserTab(serverId());
        if (closed) void openTab(closed.url, { index: closed.index });
      }}
      onReload={(tabId) => void reloadBrowserTab(tabId)}
      onNavigate={(tabId, direction) => void navigateBrowserTab(tabId, direction)}
      onOpenAddress={(url, tabId) => void openBrowserAddress(url, tabId === undefined)}
      canEnterPip={!props.runtime}
      onSurface={setBrowserSurfaceElement}
      liveViewTabId={
        props.server?.kind === "remote" && serverSupportsCapability(props.server, "browser-view")
          ? (activeBrowserTab()?.id ?? null)
          : null
      }
      liveViewRuntime={props.browserRuntime ?? conversationPort().browser}
      liveViewClipboard={serverSupportsCapability(props.server, "browser-view-clipboard")}
      onBack={() => setActiveRightPanel("browser")}
      onEnterPip={props.runtime ? () => undefined : showBrowserPip}
      dock={<BrowserDockAdapter tab={activeBrowserTab()} />}
    />
  );
}
