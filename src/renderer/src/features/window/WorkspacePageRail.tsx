import { isUpdateActivePhase } from "@openbot/contracts/ipc";
import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import type { SidebarView } from "@openbot/ui/features/sidebar/sidebar-types";
import { HelpMenu, type HelpMenuNews } from "@openbot/ui/features/updates/HelpMenu";
import { whatsNewEntry } from "@openbot/ui/features/updates/whats-new";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal } from "solid-js";
import { appPort } from "../../app-port";
import { useLayout } from "../../layout";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { withHostAccountUsage } from "../agents/host-provider-accounts";
import { useChannels } from "../channels/channels-context";
import { useSettings } from "../settings/settings-context";
import { useUpdates } from "../updates/updates-context";
import { useWhatsNew } from "../updates/whats-new-context";
import { compareReleaseVersions } from "../updates/whats-new-history";
import { loadWhatsNewReleases } from "../updates/whats-new-releases";
import { PageRail, type PageRailPage } from "./PageRail";
import { useWindowPage } from "./window-page-context";

/** The newest releases that the Help menu lists, one line each. */
const HELP_NEWS_COUNT = 3;

/**
 * The Help menu of the rail. The first time it opens, it reads the release notes in the app and lists
 * the first note of each of the newest releases, up to this version.
 */
function RailHelpMenu() {
  const whatsNew = useWhatsNew();
  const [news, setNews] = createSignal<readonly HelpMenuNews[]>([]);
  let loading = false;

  async function loadNews() {
    if (loading || news().length > 0) return;
    loading = true;
    try {
      const version = whatsNew.state.version;
      const releases = await loadWhatsNewReleases(AbortSignal.timeout(10_000));
      setNews(
        releases
          .filter((release) => !version || compareReleaseVersions(release.version, version) <= 0)
          .sort((a, b) => compareReleaseVersions(b.version, a.version))
          .flatMap((release) => {
            const note = release.groups[0]?.items[0];
            return note ? [{ headline: whatsNewEntry(note).headline, date: release.date }] : [];
          })
          .slice(0, HELP_NEWS_COUNT),
      );
    } catch {
      // The menu shows its links without the list. The next opening tries again.
    } finally {
      loading = false;
    }
  }

  return (
    <HelpMenu
      news={news()}
      triggerClass="window-rail-button"
      onOpen={() => void loadNews()}
      onOpenWhatsNew={whatsNew.reopen}
      onOpenChangelog={() => void appPort().openExternal("changelog")}
      onOpenGuides={() => void appPort().openExternal("guides")}
      onOpenDiscord={() => void appPort().openExternal("discord")}
      onSendFeedback={() => void appPort().openExternal("feedback")}
    />
  );
}

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
      help={<RailHelpMenu />}
    />
  );
}
