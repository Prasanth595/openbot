import type { AppTextKey } from "@openbot/i18n";
import { Button, Input, Search } from "@openbot/ui";
import { ServerMark } from "@openbot/ui/features/servers/ServerRail";
import { createSignal, For, flush, onSettled, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { useServerSettings } from "../servers/server-settings";
import { useSettings } from "../settings/settings-context";
import { navItem, type SettingsTab } from "../settings/settings-tabs";
import { type SettingsKind, useWindowPage } from "./window-page-context";

/** The row titles of each personal tab, in page order, with the description that the search also reads. */
const SEARCH_ROWS: { tab: SettingsTab; titleKey: AppTextKey; descriptionKey: AppTextKey }[] = [
  { tab: "general", titleKey: "settings.language.title", descriptionKey: "settings.language.description" },
  { tab: "general", titleKey: "settings.logoColor.title", descriptionKey: "settings.logoColor.description" },
  { tab: "general", titleKey: "settings.sendShortcut.title", descriptionKey: "settings.sendShortcut.description" },
  { tab: "general", titleKey: "settings.busyMessage.title", descriptionKey: "settings.busyMessage.description" },
  {
    tab: "general",
    titleKey: "settings.agentMemoryLimit.title",
    descriptionKey: "settings.agentMemoryLimit.description",
  },
  { tab: "general", titleKey: "settings.externalLinks.title", descriptionKey: "settings.externalLinks.description" },
  { tab: "general", titleKey: "settings.launchAtLogin.title", descriptionKey: "settings.launchAtLogin.description" },
  {
    tab: "general",
    titleKey: "settings.keepRemoteSessions.title",
    descriptionKey: "settings.keepRemoteSessions.description",
  },
  { tab: "general", titleKey: "settings.keepRunning.title", descriptionKey: "settings.keepRunning.description" },
  {
    tab: "general",
    titleKey: "settings.restoreWorkspace.title",
    descriptionKey: "settings.restoreWorkspace.description",
  },
  { tab: "general", titleKey: "settings.turbo.title", descriptionKey: "settings.turbo.description" },
  { tab: "general", titleKey: "settings.analytics.title", descriptionKey: "settings.analytics.description" },
  {
    tab: "notifications",
    titleKey: "settings.desktopNotifications.title",
    descriptionKey: "settings.desktopNotifications.description",
  },
  {
    tab: "notifications",
    titleKey: "settings.notificationPreview.title",
    descriptionKey: "settings.notificationPreview.description",
  },
  {
    tab: "notifications",
    titleKey: "settings.testNotification.title",
    descriptionKey: "settings.testNotification.description",
  },
  { tab: "notifications", titleKey: "settings.taskSound.title", descriptionKey: "settings.taskSound.description" },
  {
    tab: "notifications",
    titleKey: "settings.soundFeedback.title",
    descriptionKey: "settings.soundFeedback.description",
  },
];

/** A broad query shows a short list, not every row. */
const SEARCH_LIMIT = 12;

type SearchRow = (typeof SEARCH_ROWS)[number];

/** The rows whose title or description holds the query. A title match comes first. */
function rankRows(query: string, text: (key: AppTextKey) => string): SearchRow[] {
  const needle = query.toLocaleLowerCase();
  const score = (row: SearchRow) => {
    const title = text(row.titleKey).toLocaleLowerCase();
    if (title.startsWith(needle)) return 0;
    if (title.includes(needle)) return 1;
    return text(row.descriptionKey).toLocaleLowerCase().includes(needle) ? 2 : 3;
  };
  return SEARCH_ROWS.map((row) => ({ row, rank: score(row) }))
    .filter((entry) => entry.rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, SEARCH_LIMIT)
    .map((entry) => entry.row);
}

/**
 * A settings page of the window: the user settings or the settings of the active server. The settings
 * panel shows its nav and content in the mounts of this page. On the user settings page, the search
 * above the nav replaces the nav with matching rows. A result opens its tab and moves to its row.
 */
export function SettingsPage(props: { kind: SettingsKind }) {
  const i18n = useI18n();
  const windowPage = useWindowPage();
  const settings = useSettings();
  const serverSettings = useServerSettings();
  const [query, setQuery] = createSignal("");
  const results = () => (query().trim() ? rankRows(query().trim(), (key) => i18n.t(key)) : null);
  let nav!: HTMLDivElement;
  let content!: HTMLDivElement;
  let root!: HTMLDivElement;

  onSettled(() => {
    windowPage.setSettingsMounts({ nav, content });
    // Escape clears the search, or else closes the page, as it closed the settings dialog. On the
    // document and after the delegated handlers, so a control that handles Escape keeps it. The focus
    // can stay on the rail button or the server menu that opened the page, so a target outside the
    // page also counts, except an open popup or a text field.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return;
      if (target && !root.contains(target) && target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      if (query()) setQuery("");
      else windowPage.showAgents();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      windowPage.setSettingsMounts(undefined);
    };
  });

  /** Opens the tab of the row, then scrolls to the row, marks it and puts the focus on its control. */
  const openResult = (row: SearchRow) => {
    setQuery("");
    // The modal applies a tab when the requested tab changes, so clear it first: a repeated tab opens again.
    settings.openAppSettings(null, undefined);
    flush();
    settings.openAppSettings(null, row.tab);
    flush();
    const title = i18n.t(row.titleKey);
    for (const marked of content.querySelectorAll("[data-search-match]")) marked.removeAttribute("data-search-match");
    const label = [...content.querySelectorAll(".settings-modal-page .settings-modal-tab-panel *")].find(
      (element) => element.childElementCount === 0 && element.textContent?.trim() === title,
    );
    const target = label?.closest(".settings-modal-card > *") ?? label;
    if (!(target instanceof HTMLElement)) return;
    target.setAttribute("data-search-match", "");
    target.scrollIntoView({ block: "center" });
    target.querySelector<HTMLElement>("button, input, select, [tabindex]")?.focus({ preventScroll: true });
  };

  return (
    <div class="settings-page" ref={root}>
      <div class="settings-page-nav">
        <Show
          when={props.kind === "personal"}
          fallback={
            <Show when={serverSettings.serverSettingsTarget()}>
              {(server) => (
                <h1 class="settings-page-title settings-page-server">
                  <span class="server-menu-mark" aria-hidden="true">
                    <ServerMark server={server()} />
                  </span>
                  <span class="server-menu-name">{server().name}</span>
                </h1>
              )}
            </Show>
          }
        >
          <h1 class="settings-page-title">{i18n.t("app.settingsPage.title")}</h1>
          <label class="search-field settings-page-search">
            <Search aria-hidden="true" />
            <Input
              type="search"
              aria-label={i18n.t("app.settingsPage.search")}
              placeholder={i18n.t("app.settingsPage.searchPlaceholder")}
              spellcheck={false}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                const top = results()?.[0];
                if (event.key === "Enter" && top) {
                  event.preventDefault();
                  openResult(top);
                }
              }}
            />
          </label>
          <Show when={results()}>
            {(rows) => (
              <Show
                when={rows().length > 0}
                fallback={<p class="settings-page-empty">{i18n.t("app.settingsPage.noResults")}</p>}
              >
                <ul class="settings-page-results" aria-label={i18n.t("app.settingsPage.results")}>
                  <For each={rows()}>
                    {(row) => {
                      const tab = navItem(row.tab);
                      const TabIcon = tab.icon;
                      return (
                        <li>
                          <Button
                            variant="ghost"
                            type="button"
                            class="settings-page-result"
                            onClick={() => openResult(row)}
                          >
                            <span class="settings-page-result-section">
                              <TabIcon aria-hidden="true" />
                              {i18n.t(tab.titleKey)}
                            </span>
                            <span class="settings-page-result-title">{i18n.t(row.titleKey)}</span>
                          </Button>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>
            )}
          </Show>
        </Show>
        <div class="settings-page-sections" ref={nav} hidden={results() !== null} />
      </div>
      <div class="settings-page-content" ref={content} />
    </div>
  );
}
