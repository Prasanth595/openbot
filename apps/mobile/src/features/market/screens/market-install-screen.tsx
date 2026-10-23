import { canAdministerServer, type InstalledSkill } from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { createMobileMarketCatalog } from "@/features/market/model/market-catalog";
import { useMarketInstalledSkills } from "@/features/market/model/market-installed";
import { routineScheduleSummary } from "@/features/servers/model/routine-schedule-summary";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { type MarketAgentInstall, marketAgentInstallsKey } from "@/features/workspace/model/market-install-receipts";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/** Review the published item before the host installs it. No catalog content is sent as code. */
export function MarketInstallScreen() {
  const { kind, id, serverId, agentId } = useLocalSearchParams<{
    kind?: string;
    id?: string;
    serverId?: string;
    agentId?: string;
  }>();
  const text = useText();
  const { t, format, errorMessage } = text;
  const { session } = useMobileSession();
  const workspace = useMobileWorkspace();
  const queryClient = useQueryClient();
  const scope = useQueryScope();
  const { theme } = useUniwind();
  const foreground = String(useCSSVariable("--openbot-text-primary"));
  // An open review stays with its host if another connection changes in the background.
  const [targetServerId] = useState(serverId ?? workspace.activeServer.id);
  const [receiptId] = useState(() => Crypto.randomUUID());
  const [selectedAgentId, setSelectedAgentId] = useState(agentId ?? "");
  const [installing, setInstalling] = useState(false);
  const [finished, setFinished] = useState(false);
  const [agentAttemptFailed, setAgentAttemptFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const server = workspace.servers.find((item) => item.id === targetServerId);
  const agents = workspace.agents.filter((agent) => agent.serverId === targetServerId);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  const apiUrl = session?.apiUrl;
  const catalog = useMemo(() => (apiUrl ? createMobileMarketCatalog(apiUrl) : null), [apiUrl]);
  const detail = useQuery({
    queryKey: ["mobile-market-detail", apiUrl, kind, id],
    enabled: Boolean(catalog && id && (kind === "agent" || kind === "skill")),
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      if (!catalog || !id) throw new Error(t("mobile.market.loadFailed"));
      if (kind === "agent") {
        const item = await runTeamEffect(catalog.agents.get(id), signal);
        if (item.id !== id) throw new Error(t("mobile.market.loadFailed"));
        return {
          kind: "agent" as const,
          item,
          // Published routines have no IDs and can have the same name. Keep one local ID per loaded row.
          routines: item.routines.map((routine) => ({ id: Crypto.randomUUID(), routine })),
        };
      }
      const item = await runTeamEffect(catalog.skills.get(id), signal);
      if (item.id !== id) throw new Error(t("mobile.market.loadFailed"));
      return { kind: "skill" as const, item };
    },
  });
  const canManageSkills = workspace.canManageAgentSkills(targetServerId);
  const installedSkills = useMarketInstalledSkills(
    targetServerId,
    selectedAgent ? [selectedAgent.id] : [],
    kind === "skill" && canManageSkills,
  )[0];
  const installedSkill = installedSkills?.data?.find(
    (skill) => skill.skillId === id && (skill.origin === undefined || skill.origin === "marketplace"),
  );
  const skillCurrent = Boolean(
    detail.data?.kind === "skill" &&
      installedSkill?.state === "installed" &&
      installedSkill.installedVersion >= detail.data.item.version,
  );
  const canInstall = Boolean(
    detail.data &&
      server &&
      canAdministerServer(server.role) &&
      showsOnline(server) &&
      (kind === "agent"
        ? workspace.canInstallAgentTemplate(targetServerId)
        : canManageSkills && selectedAgent && installedSkills?.isSuccess && !skillCurrent),
  );
  usePreventRemove(installing && !finished, () => undefined);
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);

  async function install() {
    const loaded = detail.data;
    if (!loaded || !canInstall || lock.current || finished || agentAttemptFailed) return;
    lock.current = true;
    setInstalling(true);
    setError(null);
    try {
      if (loaded.kind === "agent") {
        const added = await workspace.installMarketplaceAgent(
          { listingId: loaded.item.id, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, receiptId },
          targetServerId,
        );
        queryClient.setQueryData<MarketAgentInstall[]>(marketAgentInstallsKey(scope, targetServerId), (current) => [
          ...(current ?? []),
          { listingId: loaded.item.id, agentId: added.id, installedAt: performance.now() },
        ]);
        void workspace.refreshServer(targetServerId).catch(() => undefined);
      } else {
        if (!selectedAgent) return;
        const installed = await workspace.installAgentSkill(
          { agentId: selectedAgent.id, skillId: loaded.item.id },
          targetServerId,
        );
        const skillsKey = queryKeys.agentSkills(scope, targetServerId, selectedAgent.id, true);
        await queryClient.cancelQueries({ queryKey: skillsKey });
        queryClient.setQueryData<InstalledSkill[] | null>(skillsKey, (current) =>
          current ? [...current.filter((skill) => skill.skillId !== installed.skillId), installed] : current,
        );
        void queryClient.invalidateQueries({
          queryKey: queryKeys.agentInfo(scope, targetServerId, selectedAgent.id),
        });
      }
      void haptics.notification("success");
      setFinished(true);
    } catch (cause) {
      if (loaded.kind === "agent") {
        setAgentAttemptFailed(true);
        void workspace.refreshServer(targetServerId).catch(() => undefined);
      }
      setError(errorMessage(cause, t("mobile.market.installFailed")));
      void haptics.notification("error");
    } finally {
      lock.current = false;
      setInstalling(false);
    }
  }

  const loaded = detail.data;
  return (
    <SheetScrollView contentContainerClassName="gap-5 px-5 pt-5 pb-safe-offset-5">
      <SheetSaveAction
        dirty={Boolean(loaded)}
        canSave={canInstall && !finished && !agentAttemptFailed}
        pending={installing}
        label={t(
          kind === "agent" ? "mobile.market.add" : skillCurrent ? "mobile.market.installed" : "mobile.market.install",
        )}
        pendingLabel={t("mobile.market.installing")}
        onSave={() => void install()}
      />
      {loaded ? (
        <>
          <View className="gap-3">
            {loaded.kind === "agent" ? (
              <BloubAvatarPreview seed={loaded.item.avatarSeed} hue={loaded.item.avatarHue} size={52} />
            ) : null}
            <Typography.Heading style={typeScale.teamSection}>{loaded.item.name}</Typography.Heading>
            <Typography.Paragraph className="text-muted" style={typeScale.marketDescription}>
              {t("mobile.link.template.creator", { name: loaded.item.creatorName })}
              {" · "}
              {t("mobile.market.version", { version: format.number(loaded.item.version) })}
            </Typography.Paragraph>
            <Typography.Paragraph style={typeScale.marketDescription}>{loaded.item.description}</Typography.Paragraph>
          </View>
          <SettingsSection title={t("mobile.link.template.server.title")}>
            <SettingsRow disclosure={false}>
              <Typography.Paragraph>{server?.name ?? t("mobile.server.unavailable")}</Typography.Paragraph>
            </SettingsRow>
            {loaded.kind === "skill" && agents.length > 0 ? (
              <SettingsRow
                disclosure={false}
                trailing={
                  <SettingsPicker
                    value={selectedAgent?.id ?? ""}
                    options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
                    label={t("mobile.market.chooseAgent")}
                    enabled={!installing}
                    dark={theme === "dark"}
                    onChange={setSelectedAgentId}
                  />
                }
              >
                <Typography.Paragraph>{t("mobile.market.chooseAgent")}</Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </SettingsSection>
          {skillCurrent ? (
            <Typography.Paragraph className="text-muted">{t("mobile.market.installed")}</Typography.Paragraph>
          ) : null}
          {!canInstall && !skillCurrent ? (
            <Typography.Paragraph className="text-muted">
              {t(
                loaded.kind === "skill" && agents.length === 0
                  ? "mobile.market.noAgents"
                  : loaded.kind === "skill" && canManageSkills && installedSkills?.isPending
                    ? "mobile.agent.info.skills.loading"
                    : loaded.kind === "skill" && canManageSkills && installedSkills?.isError
                      ? "mobile.agent.info.skills.failed"
                      : "mobile.market.installUnavailable",
              )}
            </Typography.Paragraph>
          ) : null}
          {loaded.kind === "skill" && installedSkills?.isError ? (
            <Button variant="secondary" onPress={() => void installedSkills.refetch()}>
              <Button.Label>{t("common.retry")}</Button.Label>
            </Button>
          ) : null}
          {loaded.kind === "agent" ? (
            <>
              {loaded.item.skills.length > 0 ? (
                <SettingsSection title={t("mobile.link.template.section.skills")}>
                  {loaded.item.skills.map((skill) => (
                    <SettingsRow key={skill.skillId} disclosure={false}>
                      <Typography.Paragraph>{skill.name}</Typography.Paragraph>
                    </SettingsRow>
                  ))}
                </SettingsSection>
              ) : null}
              {loaded.item.routines.length > 0 ? (
                <SettingsSection title={t("mobile.link.template.section.routines")}>
                  {loaded.routines.map(({ id, routine }) => (
                    <SettingsRow
                      key={id}
                      disclosure={false}
                      supportingText={`${routineScheduleSummary(routine.schedule, text)} · ${t(routine.active ? "mobile.server.routines.status.active" : "mobile.server.routines.status.paused")}`}
                    >
                      <Typography.Paragraph>{routine.name}</Typography.Paragraph>
                    </SettingsRow>
                  ))}
                </SettingsSection>
              ) : null}
              {loaded.item.activeRoutineCount > 0 ? (
                <Typography.Paragraph className="text-muted" style={typeScale.marketDescription}>
                  {t("mobile.market.routinesNotice", { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                </Typography.Paragraph>
              ) : null}
            </>
          ) : (
            <View className="gap-3">
              <Typography.Heading type="h4">{t("mobile.link.template.section.instructions")}</Typography.Heading>
              <ChatMarkdown
                body={loaded.item.instructions}
                color={foreground}
                compact
                finished
                animationEnabled={false}
              />
            </View>
          )}
        </>
      ) : detail.isError || !catalog || !id || (kind !== "agent" && kind !== "skill") ? (
        <View className="gap-3">
          <Typography.Paragraph accessibilityRole="alert">{t("mobile.market.loadFailed")}</Typography.Paragraph>
          <Button variant="secondary" onPress={() => void detail.refetch()}>
            <Button.Label>{t("common.retry")}</Button.Label>
          </Button>
        </View>
      ) : (
        <Typography.Paragraph className="text-muted">{t("mobile.market.loading")}</Typography.Paragraph>
      )}
      {agentAttemptFailed ? (
        <View className="gap-3">
          <Typography.Paragraph>{t("mobile.market.checkTeam")}</Typography.Paragraph>
          <Button
            variant="secondary"
            onPress={() => {
              if (workspace.servers.some((item) => item.id === targetServerId)) workspace.selectServer(targetServerId);
              router.dismissTo("/connected");
            }}
          >
            <Button.Label>{t("mobile.agent.team.tabTeam")}</Button.Label>
          </Button>
        </View>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}
