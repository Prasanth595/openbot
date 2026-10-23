import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AvatarHue,
  agentPermissionLevel,
  canAdministerServer,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type HostProviderAccounts,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Bell from "lucide-react-native/icons/bell";
import Brain from "lucide-react-native/icons/brain";
import ChartNoAxesColumn from "lucide-react-native/icons/chart-no-axes-column";
import Clock from "lucide-react-native/icons/clock";
import Files from "lucide-react-native/icons/files";
import Monitor from "lucide-react-native/icons/monitor";
import Puzzle from "lucide-react-native/icons/puzzle";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import Table from "lucide-react-native/icons/table";
import Upload from "lucide-react-native/icons/upload";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  AgentAccessFields,
  PERMISSION_LABEL,
  useAgentAdminSettings,
} from "@/features/agents/components/agent-access-fields";
import { AgentAppearancePicker } from "@/features/agents/components/agent-appearance-picker";
import { AgentBrainCard } from "@/features/agents/components/agent-brain-card";
import { AgentNewChatSection, AgentNotificationsRow } from "@/features/agents/components/agent-chat-settings";
import { AgentBusyMessageField, AgentHostPermissionFields } from "@/features/agents/components/agent-host-fields";
import { AgentInformation } from "@/features/agents/components/agent-information";
import { type AgentPhotoDraft, AgentPhotoPicker } from "@/features/agents/components/agent-photo-picker";
import { AgentProfileFields, AgentProfileHero } from "@/features/agents/components/agent-profile-content";
import { AgentPublish } from "@/features/agents/components/agent-publish";
import { AgentRuntimeFields, useProviderAccounts } from "@/features/agents/components/agent-runtime-fields";
import { AgentSessionSettingsSection } from "@/features/agents/components/agent-session-settings";
import { AgentSharedTables } from "@/features/agents/components/agent-shared-tables";
import { AgentTasksRow } from "@/features/agents/components/agent-tasks-row";
import { instructionsTooLong } from "@/features/agents/components/instructions-limit";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspace,
} from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { ProfileRow, ProfileSection } from "@/shared/components/profile-content";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

type AgentEdits = Pick<
  UpdateAgentInput,
  "name" | "title" | "description" | "avatarSeed" | "avatarHue" | "provider" | "model" | "reasoningEffort"
>;

type AgentPage =
  | "info"
  | "appearance"
  | "usage"
  | "memories"
  | "skills"
  | "files"
  | "routines"
  | "tables"
  | "publish"
  | "runtime"
  | "permissions"
  | "advanced"
  | "memory"
  | "routine";

export function EditAgentScreen({ page = "info" }: { page?: AgentPage }) {
  const { t } = useText();
  const { agentId, serverId } = useLocalSearchParams<{ agentId: string; serverId?: string }>();
  const workspace = useMobileWorkspace();
  const [hostId] = useState(serverId ?? workspace.activeServer.id);
  const agent = workspace.agents.find((candidate) => candidate.id === agentId && candidate.serverId === hostId);
  const host = workspace.servers.find((candidate) => candidate.id === hostId);
  // Keep the mounted form and its edits if the agent disappears during a reconnect or deletion.
  const lastAgent = useRef(agent);
  if (agent) lastAgent.current = agent;
  const displayed = agent ?? lastAgent.current;
  if (displayed) {
    return <AgentForm agent={displayed} host={host} available={Boolean(agent && showsOnline(host))} page={page} />;
  }
  return (
    <SheetScrollView className="bg-sheet" contentContainerClassName="p-5 pb-safe-offset-5">
      <Typography.Paragraph>
        {t(host?.initialConnectionPending ? "mobile.agent.edit.loading" : "mobile.agent.edit.gone")}
      </Typography.Paragraph>
    </SheetScrollView>
  );
}

function AgentForm({
  agent,
  host,
  available,
  page,
}: {
  agent: MobileAgent;
  host: MobileServer | undefined;
  available: boolean;
  page: AgentPage;
}) {
  const { t, errorMessage } = useText();
  const {
    updateAgent,
    setAgentAvatar,
    canManageSharedTables,
    canPublishAgent,
    canStartNewChat,
    canManageAgentAccess,
    canManageAgentHostSettings,
    setAgentProviderAccount,
    browserViewSupport,
  } = useMobileWorkspace();
  const browserAllowed = useBrowserFeature();
  const showBrowser = browserAllowed && browserViewSupport(agent.serverId).view;
  const queryClient = useQueryClient();
  // The Permissions row shows the access, as on desktop. Its page reads the same host answer.
  const { settings: adminSettings } = useAgentAdminSettings(agent, host, available && page === "info");
  const showPermissions = canManageAgentAccess(agent.serverId) || canManageAgentHostSettings(agent.serverId);
  const showNotifications = agent.notifications !== undefined;
  const navigation = useNavigation();
  const [edits, setEdits] = useState<AgentEdits>({});
  const foreground = useThemeColor("foreground");
  const [photo, setPhoto] = useState<AgentPhotoDraft | null | undefined>();
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // The account is not in the agent summary. Only an owner or admin of a host with
  // `provider-accounts-v1` reads it.
  const { queryKey: accountsKey, accounts: hostAccounts } = useProviderAccounts(agent, available && page === "runtime");
  const [account, setAccount] = useState<string | undefined>();
  const provider = edits.provider ?? agent.provider;
  const providerAccounts = hostAccounts?.providers.find((entry) => entry.provider === provider)?.accounts ?? [];
  // A provider change returns the agent to the new provider's own sign-in.
  const savedAccount =
    provider === agent.provider
      ? (hostAccounts?.agents.find((entry) => entry.agentId === agent.id)?.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID)
      : DEFAULT_PROVIDER_ACCOUNT_ID;
  const accountChanged = account !== undefined && account !== savedAccount;
  const name = edits.name ?? agent.name;
  const title = edits.title ?? agent.title;
  const description = edits.description ?? agent.description;
  const avatarSeed = edits.avatarSeed ?? agent.avatarSeed;
  const avatarHue = edits.avatarHue === undefined ? agent.avatarHue : edits.avatarHue;
  const photoChanged = photo !== undefined && (photo !== null || Boolean(agent.avatarUrl));
  const dirty =
    photoChanged ||
    name.trim() !== agent.name ||
    title.trim() !== agent.title ||
    description.trim() !== agent.description ||
    avatarSeed !== agent.avatarSeed ||
    avatarHue !== agent.avatarHue ||
    (edits.provider !== undefined && edits.provider !== agent.provider) ||
    (edits.model !== undefined && edits.model !== agent.model) ||
    (edits.reasoningEffort !== undefined && edits.reasoningEffort !== agent.reasoningEffort) ||
    accountChanged;
  const valid =
    page !== "info" ||
    (Boolean(name.trim()) &&
      name.length <= INPUT_LIMITS.agentName &&
      title.length <= INPUT_LIMITS.agentTitle &&
      !instructionsTooLong(description));

  usePreventRemove(dirty || saving || pickingPhoto, ({ data }) => {
    if (pending.current || pickingPhoto) return;
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  function change(value: AgentEdits) {
    setEdits((current) => ({ ...current, ...value }));
    setError(null);
  }
  // Stable handlers let the memoized face and color choices skip unrelated renders.
  const changeAvatarSeed = useCallback((avatarSeed: string) => {
    setEdits((current) => ({ ...current, avatarSeed }));
    setError(null);
  }, []);
  const changeAvatarHue = useCallback((avatarHue: AvatarHue | null) => {
    setEdits((current) => ({ ...current, avatarHue }));
    setError(null);
  }, []);
  const hasPhoto = photo === undefined ? Boolean(agent.avatarUrl) : Boolean(photo);
  const photoField = useMemo(
    () => (
      <AgentPhotoPicker
        hasPhoto={hasPhoto}
        cropRoute={{
          pathname: "/agent-info/[agentId]/crop-photo",
          params: { agentId: agent.id, serverId: agent.serverId },
        }}
        disabled={saving || pickingPhoto}
        onChange={(value) => {
          setPhoto(value);
          setError(null);
        }}
        onBusyChange={setPickingPhoto}
      />
    ),
    [hasPhoto, agent.id, agent.serverId, saving, pickingPhoto],
  );

  async function submit(): Promise<void> {
    if (!valid || !dirty || !available || pickingPhoto || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      if (Object.keys(edits).length > 0)
        await updateAgent(
          {
            agentId: agent.id,
            ...(edits.name === undefined ? {} : { name: name.trim() }),
            ...(edits.title === undefined ? {} : { title: title.trim() }),
            ...(edits.description === undefined ? {} : { description: description.trim() }),
            ...(edits.avatarSeed === undefined ? {} : { avatarSeed }),
            ...(edits.avatarHue === undefined ? {} : { avatarHue }),
            ...(edits.provider === undefined ? {} : { provider: edits.provider }),
            ...(edits.model === undefined ? {} : { model: edits.model }),
            ...(edits.reasoningEffort === undefined ? {} : { reasoningEffort: edits.reasoningEffort }),
          },
          agent.serverId,
        );
      setEdits({});
      if (accountChanged || (edits.provider !== undefined && edits.provider !== agent.provider)) {
        const accountId = account === undefined || account === DEFAULT_PROVIDER_ACCOUNT_ID ? null : account;
        if (accountChanged) await setAgentProviderAccount({ agentId: agent.id, accountId }, agent.serverId);
        setAccount(undefined);
        queryClient.setQueryData<HostProviderAccounts | null>(accountsKey, (current) =>
          current
            ? {
                ...current,
                agents: [
                  ...current.agents.filter((entry) => entry.agentId !== agent.id),
                  ...(accountId ? [{ agentId: agent.id, accountId }] : []),
                ],
              }
            : current,
        );
      }
      if (photoChanged) {
        await setAgentAvatar(agent.id, photo ?? null, agent.serverId);
        setPhoto(undefined);
      }
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.edit.failed")));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <SheetScrollView
      className={page === "info" ? "bg-team-canvas" : "bg-sheet"}
      headerOverlaysContent={page !== "info"}
      contentContainerClassName={
        page === "info" ? "gap-5 px-5 pb-safe-offset-5 pt-3" : "gap-5 px-5 pb-safe-offset-5 pt-5"
      }
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {page === "info" ? (
        <>
          <AgentProfileHero
            agent={{ ...agent, name, title }}
            onAppearance={() => {
              void haptics.impact("soft");
              router.push({
                pathname: "/agent-info/[agentId]/appearance",
                params: { agentId: agent.id, serverId: agent.serverId },
              });
            }}
          />
          <AgentBrainCard agent={agent} available={available} />
          <AgentProfileFields name={name} title={title} description={description} disabled={saving} onChange={change} />
        </>
      ) : null}
      {page === "appearance" ? (
        <AgentAppearancePicker
          agentId={agent.id}
          serverId={agent.serverId}
          imageUrl={photo === undefined ? undefined : (photo?.uri ?? null)}
          seed={avatarSeed}
          hue={avatarHue}
          name={name}
          nameField={null}
          showFaces={!hasPhoto}
          photoField={photoField}
          disabled={saving || pickingPhoto}
          onSeedChange={changeAvatarSeed}
          onHueChange={changeAvatarHue}
        />
      ) : null}
      {page === "runtime" ? (
        <AgentRuntimeFields
          serverId={agent.serverId}
          available={available}
          saving={saving}
          provider={provider}
          foreignProvider={edits.provider === undefined ? agent.foreignProvider : undefined}
          model={edits.model ?? agent.model}
          reasoningEffort={edits.reasoningEffort ?? agent.reasoningEffort}
          accounts={providerAccounts}
          accountId={account ?? savedAccount}
          onChange={(value) => {
            change(value);
            // An account belongs to one provider.
            if (value.provider !== undefined) setAccount(undefined);
          }}
          onAccountChange={(value) => {
            setAccount(value);
            setError(null);
          }}
        />
      ) : null}
      {page === "permissions" ? (
        <>
          <AgentAccessFields agent={agent} server={host} available={available} />
          <AgentHostPermissionFields agent={agent} server={host} available={available} />
        </>
      ) : null}
      {page === "advanced" ? (
        <>
          <AgentBusyMessageField agent={agent} server={host} available={available} />
          {agent.workspacePath ? (
            <SettingsSection title={t("mobile.agent.workspace.title")} footer={t("mobile.agent.workspace.footer")}>
              <SettingsRow>
                <Typography.Paragraph selectable type="body-sm">
                  {agent.workspacePath}
                </Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
          ) : null}
          {canStartNewChat(agent.serverId) ? <AgentNewChatSection agent={agent} available={available} /> : null}
        </>
      ) : null}
      {page === "advanced" ? (
        <>
          <ProfileSection title={t("mobile.agent.groups.knows")}>
            <ProfileRow
              leading={<Brain size={18} color={foreground} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/memories",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.agent.info.memories.title")}</Typography.Paragraph>
            </ProfileRow>
            <ProfileRow
              leading={<Files size={18} color={foreground} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/files",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.agent.info.files.title")}</Typography.Paragraph>
            </ProfileRow>
          </ProfileSection>
          <ProfileSection title={t("mobile.agent.groups.does")}>
            <AgentTasksRow agent={agent} />
            <ProfileRow
              leading={<Clock size={18} color={foreground} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/routines",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.agent.info.routines.title")}</Typography.Paragraph>
            </ProfileRow>
            <ProfileRow
              leading={<ChartNoAxesColumn size={18} color={foreground} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/usage",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.agent.info.usage.title")}</Typography.Paragraph>
            </ProfileRow>
          </ProfileSection>
          {host && canAdministerServer(host.role) ? (
            <AgentSessionSettingsSection key={`${agent.serverId}:${agent.id}`} agent={agent} available={available} />
          ) : null}
        </>
      ) : null}
      {page === "tables" ? <AgentSharedTables agent={agent} available={available} /> : null}
      {page === "publish" ? <AgentPublish agent={agent} available={available} /> : null}
      {page === "usage" ||
      page === "memories" ||
      page === "skills" ||
      page === "files" ||
      page === "routines" ||
      page === "memory" ||
      page === "routine" ? (
        <AgentInformation agent={agent} available={available} section={page} />
      ) : null}
      {!available ? <Typography.Paragraph>{t("mobile.agent.edit.unavailable")}</Typography.Paragraph> : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      {page === "info" || page === "appearance" || page === "runtime" ? (
        <SheetSaveAction
          dirty={dirty}
          canSave={valid && available}
          pending={saving || pickingPhoto}
          onSave={() => void submit()}
        />
      ) : null}
      {/* Keep all existing settings links and host capability checks. */}
      {page === "info" ? (
        <>
          <ProfileSection title={t("mobile.agent.groups.knows")}>
            <ProfileRow
              leading={<Puzzle size={18} color={foreground} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/skills",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 23, fontWeight: "500" }}>
                {t("mobile.agent.info.skills.title")}
              </Typography.Paragraph>
            </ProfileRow>
            {canManageSharedTables(agent.serverId) ? (
              <ProfileRow
                leading={<Table size={18} color={foreground} />}
                onPress={() =>
                  router.push({
                    pathname: "/agent-info/[agentId]/tables",
                    params: { agentId: agent.id, serverId: agent.serverId },
                  })
                }
              >
                <Typography.Paragraph style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 23, fontWeight: "500" }}>
                  {t("mobile.agent.tables.title")}
                </Typography.Paragraph>
              </ProfileRow>
            ) : null}
          </ProfileSection>
          {showBrowser || canPublishAgent(agent.serverId) ? (
            <ProfileSection title={t("mobile.agent.groups.does")}>
              {showBrowser ? (
                <ProfileRow
                  leading={<Monitor size={18} color={foreground} />}
                  disabled={!available}
                  onPress={() =>
                    router.push({
                      pathname: "/browser/[agentId]",
                      params: { agentId: agent.id, serverId: agent.serverId },
                    })
                  }
                >
                  <Typography.Paragraph
                    style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 23, fontWeight: "500" }}
                  >
                    {t("mobile.browser.open")}
                  </Typography.Paragraph>
                </ProfileRow>
              ) : null}
              {canPublishAgent(agent.serverId) ? (
                <ProfileRow
                  leading={<Upload size={18} color={foreground} />}
                  onPress={() =>
                    router.push({
                      pathname: "/agent-info/[agentId]/publish",
                      params: { agentId: agent.id, serverId: agent.serverId },
                    })
                  }
                >
                  <Typography.Paragraph
                    style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 23, fontWeight: "500" }}
                  >
                    {t("mobile.agent.publish.title")}
                  </Typography.Paragraph>
                </ProfileRow>
              ) : null}
            </ProfileSection>
          ) : null}
          <ProfileSection
            title={t("mobile.agent.groups.rules")}
            footer={showNotifications ? t("mobile.agent.notifications.footer") : undefined}
          >
            {showPermissions ? (
              <ProfileRow
                leading={<ShieldCheck size={18} color={foreground} />}
                supportingText={adminSettings ? t(PERMISSION_LABEL[agentPermissionLevel(adminSettings)]) : undefined}
                onPress={() =>
                  router.push({
                    pathname: "/agent-info/[agentId]/permissions",
                    params: { agentId: agent.id, serverId: agent.serverId },
                  })
                }
              >
                <Typography.Paragraph style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 23, fontWeight: "500" }}>
                  {t("mobile.agent.permissions.title")}
                </Typography.Paragraph>
              </ProfileRow>
            ) : null}
            {showNotifications ? (
              <AgentNotificationsRow
                agent={agent}
                available={available}
                leading={<Bell size={18} color={foreground} />}
              />
            ) : null}
            <ProfileRow
              leading={<SlidersHorizontal size={18} color={foreground} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/advanced",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph style={{ fontFamily: "Inter", fontSize: 16, lineHeight: 23, fontWeight: "500" }}>
                {t("mobile.agent.advanced.title")}
              </Typography.Paragraph>
            </ProfileRow>
          </ProfileSection>
        </>
      ) : null}
    </SheetScrollView>
  );
}
