import { isUpdateActivePhase } from "@openbot/contracts/ipc";
import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import type { SidebarView } from "@openbot/ui/features/sidebar/sidebar-types";
import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import { appPort } from "../../app-port";
import { useLayout } from "../../layout";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { withHostAccountUsage } from "../agents/host-provider-accounts";
import { useChannels } from "../channels/channels-context";
import { useSettings } from "../settings/settings-context";
import { useUpdates } from "../updates/updates-context";
import { useWhatsNew } from "../updates/whats-new-context";
import { PageRail, type PageRailPage } from "./PageRail";
import { RailHelpMenu } from "./RailHelpMenu";
import { useWindowPage } from "./window-page-context";

/**
 * The page rail of the desktop window. Agents, Routines, Schedule, Usage, Marketplace and Settings
 * change the page in the card.
 */
export function WorkspacePageRail(props: { hidden: boolean }) {
  const text = useText();
  const windowPage = useWindowPage();
  const auth = useAuth();
  const { agentStatus, hostAccountLimits } = useAgents();
  const { openAppSettings, setSkillsMarketplaceOpen } = useSettings();
  const updates = useUpdates();
  const layout = useLayout();
  const channels = useChannels();
  const whatsNew = useWhatsNew();
  /** Agents and Routines show the same page; they set the list of the sidebar. */
  function showSidebarView(view: SidebarView) {
    windowPage.showAgents();
    // An open channel would stay in the middle with no row in the list.
    if (view === "routines") channels.close();
    layout.setSidebarView(view);
  }
  const usageRows = createMemo(() =>
    accountUsageProviderRows(
      withHostAccountUsage(auth.accountUsage(), hostAccountLimits()),
      agentStatus().providers,
      text,
    ).filter((row) => row.reportsUsage && row.windows.length > 0),
  );
  /** The compact sidebar has no footer, so the update island does not show. The Settings button then marks the update. */
  const updateNotice = () => {
    const phase = updates.status().phase;
    if (!layout.leftPanelCompact() || !isUpdateActivePhase(phase)) return undefined;
    return text.t(phase === "ready" || phase === "installing" ? "account.update.ready" : "account.update.available");
  };
  const current = (): PageRailPage | null => {
    const page = windowPage.page();
    if (page === "agents") return layout.sidebarView();
    return page === "server-settings" ? null : page;
  };
  return (
    <PageRail
      hidden={props.hidden}
      current={current()}
      usageRows={usageRows()}
      onAgents={() => showSidebarView("agents")}
      onRoutines={() => showSidebarView("routines")}
      onSchedule={windowPage.openSchedule}
      onUsage={windowPage.openUsage}
      onMarketplace={() => setSkillsMarketplaceOpen(true)}
      onSettings={(button) => (updateNotice() ? openAppSettings(button, "updates") : windowPage.openSettings(button))}
      settingsNotice={updateNotice()}
      help={
        <RailHelpMenu
          version={whatsNew.state.version}
          onOpenWhatsNew={whatsNew.reopen}
          onOpenLink={(destination) => void appPort().openExternal(destination)}
        />
      }
    />
  );
}
