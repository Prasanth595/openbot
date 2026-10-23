import { OPENBOT_CONTROL_PLANE_ORIGIN } from "@openbot/contracts/invite-links";
import {
  canAdministerServer,
  type MarketplaceAgentSummary,
  type MarketplaceSkillSummary,
  type McpServerConfig,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import Boxes from "lucide-react-native/icons/boxes";
import Check from "lucide-react-native/icons/check";
import Download from "lucide-react-native/icons/download";
import Plus from "lucide-react-native/icons/plus";
import Settings2 from "lucide-react-native/icons/settings-2";
import Sparkles from "lucide-react-native/icons/sparkles";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { MarketHeader, type MarketTab } from "@/features/market/components/market-header";
import { MarketItemRow } from "@/features/market/components/market-item-row";
import { MARKET_APPS, type MarketApp, matchesMarketApp } from "@/features/market/model/market-apps";
import { createMobileMarketCatalog } from "@/features/market/model/market-catalog";
import { useMarketInstalledAgents, useMarketInstalledSkills } from "@/features/market/model/market-installed";
import { useWorkTabServer } from "@/features/servers/model/use-work-tab-server";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";
import { ScrollTouchArea } from "@/shared/components/scroll-touch-area";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

type MarketRow =
  | { kind: "heading"; id: string; title: string }
  | { kind: "agent"; id: string; agent: MarketplaceAgentSummary }
  | { kind: "skill"; id: string; skill: MarketplaceSkillSummary }
  | { kind: "app"; id: string; app: MarketApp }
  | { kind: "configured"; id: string; config: McpServerConfig; app: MarketApp | undefined };

/** Catalog images load only from the configured HTTPS account-service origin. */
function catalogImageUrl(value: string | null, apiUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, apiUrl);
    return url.protocol === "https:" && url.origin === new URL(apiUrl).origin && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function MarketScreen() {
  const { t, format, errorMessage } = useText();
  const { session } = useMobileSession();
  const { agentId, tab: requestedTab } = useLocalSearchParams<{ agentId?: string; tab?: string }>();
  const serverId = useWorkTabServer();
  const workspace = useMobileWorkspace();
  const server = workspace.servers.find((item) => item.id === serverId);
  const apiUrl = session?.apiUrl ?? OPENBOT_CONTROL_PLANE_ORIGIN;
  const catalog = useMemo(() => createMobileMarketCatalog(apiUrl), [apiUrl]);
  const scope = useQueryScope();
  const [tab, setTab] = useState<MarketTab>(
    requestedTab === "apps" || requestedTab === "skills" ? requestedTab : "agents",
  );
  useFocusEffect(
    useCallback(() => {
      if (requestedTab !== "agents" && requestedTab !== "apps" && requestedTab !== "skills") return;
      setTab(requestedTab);
      router.setParams({ tab: undefined });
    }, [requestedTab]),
  );
  const targetAgentId = workspace.agents.find((agent) => agent.id === agentId && agent.serverId === serverId)?.id;
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const [queries, setQueries] = useState({ agents: "", apps: "", skills: "" });
  const [debouncedQueries, setDebouncedQueries] = useState(queries);
  const searchInput = queries[tab];
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedQueries((current) => ({ ...current, [tab]: searchInput }));
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchInput, tab]);
  const query = debouncedQueries[tab].trim();
  const [category, setCategory] = useState<SkillCategory>();
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const options = {
    query: query || undefined,
    category,
    featured: featuredOnly || undefined,
    sort: "installs" as const,
    limit: 24,
  };
  const agents = useInfiniteQuery({
    queryKey: ["mobile-market", apiUrl, "agents", query, category, featuredOnly],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      runTeamEffect(catalog.agents.list({ ...options, cursor: pageParam || undefined }), signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: tab === "agents",
    retry: false,
  });
  const skills = useInfiniteQuery({
    queryKey: ["mobile-market", apiUrl, "skills", query, category, featuredOnly],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      runTeamEffect(catalog.skills.list({ ...options, cursor: pageParam || undefined }), signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: tab === "skills",
    retry: false,
  });
  const canManageApps = workspace.canManageMcpServers(serverId);
  const configured = useQuery({
    queryKey: queryKeys.mcpServers(scope, serverId),
    queryFn: () => workspace.listMcpServers(serverId),
    enabled: tab === "apps" && canManageApps,
    retry: false,
  });
  const canAddAgent = Boolean(
    server && showsOnline(server) && canAdministerServer(server.role) && workspace.canInstallAgentTemplate(serverId),
  );
  const canInstallSkill = workspace.canManageAgentSkills(serverId);
  const installedAgents = useMarketInstalledAgents(serverId);
  const skillAgents = workspace.agents.filter(
    (agent) => agent.serverId === serverId && (!targetAgentId || agent.id === targetAgentId),
  );
  const installedSkillLists = useMarketInstalledSkills(
    serverId,
    skillAgents.map((agent) => agent.id),
    tab === "skills" && focused && foreground && canInstallSkill,
  );
  const installedSkills = new Set(
    installedSkillLists.flatMap((list) =>
      (list.data ?? []).flatMap((skill) =>
        skill.origin === undefined || skill.origin === "marketplace" ? [skill.skillId] : [],
      ),
    ),
  );
  const installed = canManageApps ? (configured.data ?? []) : [];
  const matchesQuery = (value: string) => value.toLowerCase().includes(query.toLowerCase());
  const appMatches = (app: MarketApp) =>
    (!category || app.category === category) &&
    (!featuredOnly || app.featured) &&
    matchesQuery(`${app.name} ${app.tagline} ${app.description} ${app.creatorName}`);
  const rows: MarketRow[] = [];
  if (tab === "agents") {
    const seen = new Set<string>();
    for (const agent of agents.data?.pages.flatMap((page) => page.agents) ?? []) {
      if (seen.has(agent.id)) continue;
      seen.add(agent.id);
      rows.push({ kind: "agent", id: `agent:${agent.id}`, agent });
    }
  } else if (tab === "skills") {
    const entries = skills.data?.pages.flatMap((page) => page.skills) ?? [];
    if (entries.length) rows.push({ kind: "heading", id: "popular", title: t("mobile.market.popular") });
    const seen = new Set<string>();
    for (const skill of entries) {
      if (seen.has(skill.id)) continue;
      seen.add(skill.id);
      rows.push({ kind: "skill", id: `skill:${skill.id}`, skill });
    }
  } else {
    const yours = installed.flatMap((config): MarketRow[] => {
      const app = MARKET_APPS.find((candidate) => matchesMarketApp(config, candidate));
      if (app ? !appMatches(app) : category || featuredOnly || !matchesQuery(config.name)) return [];
      return [{ kind: "configured", id: `configured:${config.id}`, config, app }];
    });
    if (yours.length) rows.push({ kind: "heading", id: "your-apps", title: t("mobile.market.yourApps") }, ...yours);
    const available = MARKET_APPS.filter(
      (app) => appMatches(app) && !installed.some((config) => matchesMarketApp(config, app)),
    );
    for (const featured of [true, false]) {
      const group = available.filter((app) => app.featured === featured);
      if (!group.length) continue;
      rows.push({
        kind: "heading",
        id: featured ? "featured-apps" : "all-apps",
        title: t(featured ? "mobile.market.popularApps" : "mobile.market.allApps"),
      });
      rows.push(...group.map((app): MarketRow => ({ kind: "app", id: `app:${app.slug}`, app })));
    }
  }
  const selectedQuery = tab === "agents" ? agents : skills;
  const pending = tab !== "apps" && selectedQuery.isPending;
  const failed = tab !== "apps" && selectedQuery.isError;
  const install = (kind: "agent" | "skill", id: string) => {
    void haptics.impact("soft");
    router.push({
      pathname: "/market-install",
      params: { kind, id, serverId, ...(targetAgentId ? { agentId: targetAgentId } : {}) },
    });
  };
  const openApp = (app: MarketApp, config?: McpServerConfig) => {
    void haptics.impact("soft");
    router.push({
      pathname: "/server-settings/mcp-server",
      params: { serverId, ...(config ? { mcpServerId: config.id } : { pluginSlug: app.slug }) },
    });
  };
  const renderRow = ({ item }: { item: MarketRow }) => {
    if (item.kind === "heading")
      return (
        <Typography.Paragraph className="px-1 pb-1 pt-3 uppercase text-muted" style={typeScale.teamMeta}>
          {item.title}
        </Typography.Paragraph>
      );
    if (item.kind === "agent") {
      const agent = item.agent;
      return (
        <MarketItemRow
          name={agent.name}
          description={agent.description}
          meta={t("mobile.market.installs", {
            creator: agent.creatorName,
            count: agent.installs,
            installs: format.number(agent.installs),
          })}
          avatar={
            <BloubAvatarPreview
              seed={agent.avatarSeed}
              hue={agent.avatarHue}
              size={44}
              animateIdle={false}
              imageUrl={catalogImageUrl(agent.avatarUrl, apiUrl)}
            />
          }
          icon={Sparkles}
          action={t(installedAgents.has(agent.id) ? "mobile.market.added" : "mobile.market.add")}
          actionIcon={installedAgents.has(agent.id) ? Check : Plus}
          disabled={!canAddAgent}
          onPress={() => install("agent", agent.id)}
        />
      );
    }
    if (item.kind === "skill") {
      const skill = item.skill;
      return (
        <MarketItemRow
          name={skill.name}
          description={skill.description}
          meta={t("mobile.market.installs", {
            creator: skill.creatorName,
            count: skill.installs,
            installs: format.number(skill.installs),
          })}
          iconUrl={catalogImageUrl(skill.iconUrl, apiUrl)}
          icon={Sparkles}
          action={t(installedSkills.has(skill.id) ? "mobile.market.installed" : "mobile.market.install")}
          actionIcon={installedSkills.has(skill.id) ? Check : Download}
          disabled={!canInstallSkill}
          onPress={() => install("skill", skill.id)}
        />
      );
    }
    if (item.kind === "configured") {
      const { app, config } = item;
      return (
        <MarketItemRow
          name={app?.name ?? config.name}
          description={app?.tagline ?? config.name}
          meta={t(config.enabled ? "mobile.server.mcp.enabled" : "mobile.server.mcp.disabled")}
          iconUrl={app ? catalogImageUrl(`/plugins/icon/${app.slug}`, apiUrl) : null}
          icon={Boxes}
          action={t("mobile.market.manage")}
          actionIcon={Settings2}
          disabled={!canManageApps}
          onPress={() =>
            app
              ? openApp(app, config)
              : router.push({ pathname: "/server-settings/mcp-server", params: { serverId, mcpServerId: config.id } })
          }
        />
      );
    }
    return (
      <MarketItemRow
        name={item.app.name}
        description={item.app.tagline}
        meta={t("mobile.market.creator", { creator: item.app.creatorName })}
        iconUrl={catalogImageUrl(`/plugins/icon/${item.app.slug}`, apiUrl)}
        icon={Boxes}
        action={t("mobile.market.connect")}
        actionIcon={Plus}
        disabled={!canManageApps || configured.isPending || configured.isError}
        onPress={() => openApp(item.app)}
      />
    );
  };
  return (
    <View collapsable={false} className="flex-1 bg-team-canvas">
      <ScrollTouchArea>
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          renderItem={renderRow}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical={false}
          contentContainerStyle={{
            paddingTop: 8,
            paddingHorizontal: 20,
            paddingBottom: 24,
          }}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (tab !== "apps" && selectedQuery.hasNextPage && !selectedQuery.isFetching && !failed)
              void selectedQuery.fetchNextPage();
          }}
          ListHeaderComponent={
            <MarketHeader
              tab={tab}
              query={queries[tab]}
              category={category}
              featuredOnly={featuredOnly}
              onTabChange={setTab}
              onQueryChange={(value) =>
                setQueries((current) => (current[tab] === value ? current : { ...current, [tab]: value }))
              }
              onCategoryChange={setCategory}
              onFeaturedChange={setFeaturedOnly}
            />
          }
          ListEmptyComponent={
            <View className="py-5">
              <Typography.Paragraph className="text-muted" style={typeScale.marketDescription}>
                {pending
                  ? t("mobile.market.loading")
                  : failed
                    ? errorMessage(selectedQuery.error, t("mobile.market.loadFailed"))
                    : t("mobile.market.empty")}
              </Typography.Paragraph>
            </View>
          }
          ListFooterComponent={
            <View className="gap-3 py-3">
              {tab === "apps" && !canManageApps ? (
                <Typography.Paragraph className="text-muted" style={typeScale.marketDescription}>
                  {t(
                    !showsOnline(server)
                      ? "mobile.market.offline"
                      : server && canAdministerServer(server.role)
                        ? "mobile.server.mcp.unsupported"
                        : "mobile.market.noAppAccess",
                  )}
                </Typography.Paragraph>
              ) : null}
              {(tab === "agents" && !canAddAgent) || (tab === "skills" && !canInstallSkill) ? (
                <Typography.Paragraph className="text-muted" style={typeScale.marketDescription}>
                  {t("mobile.market.installUnavailable")}
                </Typography.Paragraph>
              ) : null}
              {tab === "apps" && configured.isError ? (
                <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
                  {errorMessage(configured.error, t("mobile.market.appLoadFailed"))}
                </Typography.Paragraph>
              ) : null}
              {failed || (tab === "apps" && configured.isError) ? (
                <Button
                  variant="secondary"
                  onPress={() => {
                    if (tab === "apps") void configured.refetch();
                    else void selectedQuery.refetch();
                  }}
                >
                  <Button.Label>{t("common.retry")}</Button.Label>
                </Button>
              ) : null}
              {tab !== "apps" && selectedQuery.isFetchingNextPage ? (
                <Typography.Paragraph className="text-muted" style={typeScale.marketDescription}>
                  {t("mobile.market.loading")}
                </Typography.Paragraph>
              ) : null}
            </View>
          }
        />
      </ScrollTouchArea>
    </View>
  );
}
