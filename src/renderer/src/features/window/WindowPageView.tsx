import { useText } from "@openbot/ui/text";
import { Loading, Show } from "solid-js";
import { AgentUsagePanel } from "../../lazy-views";
import { SkillsMarketplace } from "../../WorkspaceOverlays";
import { SchedulePanel } from "../schedule/SchedulePanel";
import { useServers } from "../servers/servers-context";
import { useUsage } from "../usage/usage-context";
import { SettingsPage } from "./SettingsPage";
import { type SettingsKind, useWindowPage } from "./window-page-context";

/** The page of the desktop window that covers the conversation: a settings page, usage, schedule or the Marketplace. */
export function WindowPageView() {
  const { t } = useText();
  const windowPage = useWindowPage();
  const usage = useUsage();
  const { servers } = useServers();
  const settingsKind = (): SettingsKind | null => {
    const page = windowPage.page();
    if (page === "settings") return "personal";
    return page === "server-settings" ? "server" : null;
  };
  const hostName = (serverId: string) =>
    servers().find((server) => server.id === serverId)?.name ?? t("app.page.serverFallback");
  return (
    <Show
      when={settingsKind() ? null : usage.state.serverId}
      fallback={
        <Show when={settingsKind()} keyed fallback={<SkillsMarketplace />}>
          {(kind) => <SettingsPage kind={kind} />}
        </Show>
      }
    >
      {(serverId) => (
        <Show
          when={usage.state.view === "schedule"}
          fallback={
            <Loading>
              <AgentUsagePanel
                serverId={serverId()}
                hostName={hostName(serverId())}
                agentId={usage.state.agentId}
                onBack={usage.closeUsage}
              />
            </Loading>
          }
        >
          <SchedulePanel serverId={serverId()} hostName={hostName(serverId())} onBack={usage.closeUsage} />
        </Show>
      )}
    </Show>
  );
}
