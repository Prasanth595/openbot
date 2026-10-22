import { DEFAULT_TEAM_MEMBER_LIMIT, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { canAdministerServer } from "@openbot/contracts/ipc";
import { WAKE_RECONNECT_STATES } from "@openbot/team-client/hosted-server-wake";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Spinner, Typography } from "heroui-native";
import ChevronsUpDown from "lucide-react-native/icons/chevrons-up-down";
import ImagePlus from "lucide-react-native/icons/image-plus";
import Minus from "lucide-react-native/icons/minus";
import Plus from "lucide-react-native/icons/plus";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { ServerNotificationSettings } from "@/features/push-notifications/components/server-notification-settings";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import { ServerAvatar } from "@/features/servers/components/server-avatar";
import {
  ServerSettingDescription,
  ServerSettingLabel,
  ServerSettingsContent,
  ServerSettingsSection,
} from "@/features/servers/components/server-settings-content";
import { ServerStatusLabel } from "@/features/servers/components/server-status-label";
import { TrailingValue } from "@/features/servers/components/trailing-value";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { timeZoneLabel } from "@/features/servers/model/time-zones";
import { useServerTimezone } from "@/features/servers/model/use-server-timezone";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { useLiveServerRecovery } from "@/features/workspace/context/server-recovery-countdown";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { type AvatarPhoto, pickAvatarPhoto } from "@/shared/lib/pick-avatar-photo";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export function ServerGeneralScreen() {
  const { t, sourceText, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { servers, memberCountByServer, leaveServer, removeServer, refreshServer, hostedServerStarting } =
    useMobileWorkspace();
  const server = useLiveServerRecovery(servers.find((item) => item.id === serverId));
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restarted, setRestarted] = useState<string | null>(null);
  const { session } = useMobileSession();
  const owner = server?.role === "owner";
  // Billing deletes a hosted server, so Remove shows only after the owner's hosted servers are known.
  const [hostedServerIds, setHostedServerIds] = useState<ReadonlySet<string> | null>(null);
  // The same rule as the Restart item of the desktop server menu.
  const canRestart =
    server?.kind === "remote" &&
    (owner || server.role === "admin") &&
    (server.hosted === true || Boolean(hostedServerIds?.has(serverId)));
  useEffect(() => {
    if (!session || !owner) return;
    let current = true;
    hostedServerCalls(session)
      .list()
      .then(
        (list) => {
          if (current) setHostedServerIds(new Set(list.servers.map((item) => item.serverId)));
        },
        () => undefined,
      );
    return () => {
      current = false;
    };
  }, [session, owner]);
  async function perform(operation: () => Promise<void>, failure?: (error: unknown) => string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setRestarted(null);
    try {
      await operation();
      void haptics.notification("success");
    } catch (caught) {
      setError(failure?.(caught) ?? t("mobile.server.settings.updateFailed"));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (!server)
    return (
      <ServerSettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </ServerSettingsContent>
    );
  const memberCount = memberCountByServer[serverId];
  const memberLimit = server.memberLimit ?? DEFAULT_TEAM_MEMBER_LIMIT;
  return (
    <ServerSettingsContent>
      <Typography.Heading style={typeScale.teamLead}>{t("mobile.server.settings.general")}</Typography.Heading>
      <ServerIdentityForm key={server.id} server={server} />
      <ServerGeneralSettings serverId={serverId} />
      <ServerNotificationSettings
        server={server}
        title={t("mobile.settings.notifications.title")}
        appearance="concept"
      />
      <SettingsSection footer={server.connectionMessage ? sourceText(server.connectionMessage) : undefined}>
        <SettingsRow disclosure={false} trailing={<ServerStatusLabel server={server} />}>
          <Typography.Paragraph>{t("mobile.server.settings.status")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          disclosure={false}
          trailing={
            <Typography.Paragraph className="text-grouped-secondary">
              {t(SERVER_ROLE_LABEL_KEYS[server.role])}
            </Typography.Paragraph>
          }
        >
          <Typography.Paragraph>{t("mobile.server.settings.yourRole")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow
          trailing={
            memberCount === undefined ? undefined : (
              <TrailingValue
                value={t("mobile.server.settings.memberCount", { count: memberCount, limit: memberLimit })}
              />
            )
          }
          onPress={() => router.push({ pathname: "/server-settings/members", params: { serverId } })}
        >
          <Typography.Paragraph>{t("mobile.server.settings.members")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.server.settings.maintenanceSection")} footer={error ?? restarted}>
        <SettingsRow disclosure={false} disabled={busy} onPress={() => void perform(() => refreshServer(serverId))}>
          <Typography.Paragraph className="text-accent">
            {busy && !restarting ? t("mobile.server.settings.refreshing") : t("mobile.server.settings.refresh")}
          </Typography.Paragraph>
        </SettingsRow>
        {canRestart ? (
          // The account server stops the hosted server and starts it again. The app connects again after it.
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                t("mobile.server.settings.restartTitle", { name: server.name }),
                t("mobile.server.settings.restartBody"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.settings.restartConfirm"),
                    onPress: () =>
                      void perform(
                        async () => {
                          if (!session) throw new Error(currentText().t("mobile.server.hosted.restartFailed"));
                          setRestarting(true);
                          try {
                            const hosted = await hostedServerCalls(session).restart(serverId);
                            // The connection drops when the server stops. The app connects again, as after a wake.
                            if (WAKE_RECONNECT_STATES.has(hosted.state)) hostedServerStarting(serverId);
                          } finally {
                            setRestarting(false);
                          }
                          setRestarted(currentText().t("mobile.server.settings.restarted", { name: server.name }));
                        },
                        // The account server explains a refusal, such as a server that cannot restart now.
                        (caught) => {
                          const text = currentText();
                          return text.errorMessage(caught, text.t("mobile.server.hosted.restartFailed"));
                        },
                      ),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph className="text-accent">
              {restarting ? t("mobile.server.settings.restarting") : t("mobile.server.settings.restart")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {server.role !== "owner" ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                t("mobile.server.settings.leaveTitle", { name: server.name }),
                t("mobile.server.settings.leaveBody"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.settings.leave"),
                    style: "destructive",
                    onPress: () =>
                      void perform(async () => {
                        await leaveServer(serverId);
                        router.dismissTo("/connected");
                      }),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.settings.leave")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : hostedServerIds && !hostedServerIds.has(serverId) ? (
        // The owner removes the server from the account. The host does not need to be online.
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              Alert.alert(
                t("mobile.server.settings.removeTitle", { name: server.name }),
                t("mobile.server.settings.removeBody"),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("mobile.server.settings.remove"),
                    style: "destructive",
                    onPress: () =>
                      void perform(
                        async () => {
                          await removeServer(serverId);
                          router.dismissTo("/connected");
                        },
                        // The account service explains a refusal, such as a hosted server that Billing deletes.
                        (caught) => errorMessage(caught, t("mobile.server.settings.updateFailed")),
                      ),
                  },
                ],
              )
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.server.settings.remove")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </ServerSettingsContent>
  );
}

/**
 * The server timezone and the memories per agent, for an owner or admin of a host that serves them.
 * The host checks the role and the value again.
 */
function ServerGeneralSettings({ serverId }: { serverId: string }) {
  const { t, format, errorMessage } = useText();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const foreground = String(useCSSVariable("--openbot-text-secondary"));
  const muted = String(useCSSVariable("--openbot-text-muted"));
  const { canManageAgentMemoryLimit } = useMobileWorkspace();
  const { loadAgentMemoryLimit, setAgentMemoryLimit } = useMobileWorkspaceActions();
  const timezone = useServerTimezone(serverId);
  const memoryLimitKey = queryKeys.agentMemoryLimit(queryScope, serverId);
  const memoryLimitAvailable = canManageAgentMemoryLimit(serverId);
  const memoryLimit = useQuery({
    queryKey: memoryLimitKey,
    enabled: memoryLimitAvailable,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => loadAgentMemoryLimit(serverId),
  });
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  if (!timezone.available && !memoryLimitAvailable) return null;
  const zone = timezone.query.data;
  const limit = memoryLimit.data;
  const choices = [...new Set(limit?.choices ?? [])].sort((a, b) => a - b);
  // A saved value from an older host remains visible; only offered values may be selected.
  const previous = limit ? choices.filter((choice) => choice < limit.limit).at(-1) : undefined;
  const next = limit ? choices.find((choice) => choice > limit.limit) : undefined;

  function chooseLimit(value: number | undefined) {
    if (value === undefined || pending.current || value === limit?.limit) return;
    pending.current = true;
    void haptics.selection();
    setSaving(true);
    setError(null);
    setAgentMemoryLimit(value, serverId)
      .then(async (saved) => {
        await queryClient.cancelQueries({ queryKey: memoryLimitKey, exact: true });
        queryClient.setQueryData(memoryLimitKey, saved);
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.server.settings.memoryLimitSaveFailed")));
      })
      .finally(() => {
        pending.current = false;
        setSaving(false);
      });
  }

  return (
    <ServerSettingsSection
      title={t("mobile.server.settings.agents")}
      footer={
        error ??
        (memoryLimit.isError
          ? errorMessage(memoryLimit.error, t("mobile.server.settings.memoryLimitLoadFailed"))
          : timezone.query.isError
            ? errorMessage(timezone.query.error, t("mobile.server.settings.timezoneLoadFailed"))
            : undefined)
      }
    >
      {timezone.available ? (
        <View className="gap-2.5 py-3 pr-3 pl-4">
          <View className="gap-1">
            <ServerSettingLabel>{t("mobile.server.settings.timezone")}</ServerSettingLabel>
            <ServerSettingDescription>{t("mobile.server.settings.timezoneDescription")}</ServerSettingDescription>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.server.settings.timezone")}
            accessibilityValue={{ text: zone?.timezone ?? zone?.systemTimezone }}
            accessibilityState={{ disabled: !zone }}
            disabled={!zone}
            onPress={() => {
              void haptics.impact("soft");
              router.push({ pathname: "/server-settings/timezone", params: { serverId } });
            }}
            className="min-h-11 flex-row items-center gap-1.5 rounded-[10px] border border-grouped-border bg-control-active px-3 py-2"
          >
            <Typography.Paragraph
              className="min-w-0 flex-1 text-text-secondary"
              style={{ ...typeScale.preview, fontFamily: "Inter", fontWeight: "500" }}
            >
              {zone
                ? zone.timezone
                  ? timeZoneLabel(zone.timezone)
                  : t("mobile.server.settings.timezoneAutomaticResolved", { zone: timeZoneLabel(zone.systemTimezone) })
                : t("mobile.server.settings.timezoneLoading")}
            </Typography.Paragraph>
            <ChevronsUpDown size={14} color={muted} />
          </Pressable>
        </View>
      ) : null}
      {memoryLimitAvailable ? (
        <View className="flex-row items-center gap-3 py-3 pr-3 pl-4">
          <View className="min-w-0 flex-1 gap-1">
            <ServerSettingLabel>{t("mobile.server.settings.memoryLimit")}</ServerSettingLabel>
            <ServerSettingDescription>{t("mobile.server.settings.memoryLimitDescription")}</ServerSettingDescription>
          </View>
          {limit ? (
            <View className="min-h-11 flex-row items-center rounded-[10px] bg-control-active">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mobile.server.settings.memoryLimit")}
                accessibilityValue={{ text: format.number(previous ?? limit.limit) }}
                accessibilityState={{ disabled: saving || previous === undefined }}
                disabled={saving || previous === undefined}
                onPress={() => chooseLimit(previous)}
                className="min-h-11 w-10 items-center justify-center"
                style={({ pressed }) => ({ opacity: saving || previous === undefined ? 0.35 : pressed ? 0.6 : 1 })}
              >
                <Minus size={16} color={foreground} />
              </Pressable>
              <Typography.Paragraph
                accessibilityLiveRegion="polite"
                style={{ ...typeScale.workTitle, fontWeight: "600" }}
              >
                {format.number(limit.limit)}
              </Typography.Paragraph>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mobile.server.settings.memoryLimit")}
                accessibilityValue={{ text: format.number(next ?? limit.limit) }}
                accessibilityState={{ disabled: saving || next === undefined }}
                disabled={saving || next === undefined}
                onPress={() => chooseLimit(next)}
                className="min-h-11 w-10 items-center justify-center"
                style={({ pressed }) => ({ opacity: saving || next === undefined ? 0.35 : pressed ? 0.6 : 1 })}
              >
                <Plus size={16} color={foreground} />
              </Pressable>
            </View>
          ) : memoryLimit.isPending ? (
            <Spinner size="sm" />
          ) : null}
        </View>
      ) : null}
    </ServerSettingsSection>
  );
}

/** The server name and logo. The host saves both and tells every connected client. */
function ServerIdentityForm({ server }: { server: MobileServer }) {
  const { t, errorMessage } = useText();
  const { canEditServerIdentity, updateServerIdentity } = useMobileWorkspace();
  const navigation = useNavigation();
  const foreground = String(useCSSVariable("--openbot-text-muted"));
  const available = canEditServerIdentity(server.id);
  const [draftName, setDraftName] = useState<string | undefined>();
  // Undefined keeps the saved logo; null removes it.
  const [logo, setLogo] = useState<AvatarPhoto | null | undefined>();
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const name = draftName ?? server.name;
  const trimmed = name.trim();
  const nameChanged = draftName !== undefined && trimmed !== server.name;
  const logoChanged = logo !== undefined && (logo !== null || server.logoKey !== null);
  const dirty = nameChanged || logoChanged;
  // A saved name from an older rule stays valid until the user changes it.
  const nameValid =
    !nameChanged || (trimmed.length >= INPUT_LIMITS.serverNameMin && trimmed.length <= INPUT_LIMITS.serverName);
  const hasLogo = logo === undefined ? server.logoKey !== null : logo !== null;

  usePreventRemove(dirty || saving || picking, ({ data }) => {
    if (pending.current || picking) return;
    void haptics.notification("warning");
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  async function chooseLogo(): Promise<void> {
    if (pending.current || picking) return;
    setPicking(true);
    setError(null);
    try {
      const photo = await pickAvatarPhoto({ pathname: "/server-settings/crop-logo" });
      if (photo) setLogo(photo);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.shared.photo.openFailed")));
    } finally {
      setPicking(false);
    }
  }

  function editLogo(): void {
    void haptics.impact("soft");
    if (!hasLogo) {
      void chooseLogo();
      return;
    }
    Alert.alert(t("mobile.server.settings.logo"), undefined, [
      { text: t("mobile.server.settings.changeLogo"), onPress: () => void chooseLogo() },
      {
        text: t("mobile.server.settings.removeLogo"),
        style: "destructive",
        onPress: () => {
          setError(null);
          setLogo(null);
        },
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  async function save(): Promise<void> {
    if (!dirty || !nameValid || !available || picking || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await updateServerIdentity(server.id, {
        ...(nameChanged ? { serverName: trimmed } : {}),
        ...(logoChanged ? { logo: logo ? { mimeType: logo.mimeType, bytes: logo.bytes } : null } : {}),
      });
      setDraftName(undefined);
      setLogo(undefined);
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.server.settings.identitySaveFailed")));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const locked = !available || saving || picking;
  return (
    <>
      <ServerSettingsSection title={t("mobile.server.settings.identity")}>
        <View className="gap-2 px-4 py-3">
          <ServerSettingLabel>{t("mobile.server.settings.name")}</ServerSettingLabel>
          <View className="h-11 justify-center rounded-[10px] border border-grouped-border bg-control-active px-3">
            <SheetFormField
              label={t("mobile.server.settings.name")}
              appearance="embedded"
              hideLabel
              autoCapitalize="words"
              maxLength={INPUT_LIMITS.serverName}
              value={name}
              editable={!locked}
              onChangeText={(value) => {
                setDraftName(value);
                setError(null);
              }}
            />
          </View>
          <ServerSettingDescription>
            {!nameValid
              ? t("mobile.server.settings.nameLength", {
                  min: INPUT_LIMITS.serverNameMin,
                  max: INPUT_LIMITS.serverName,
                })
              : t("mobile.server.settings.nameDescription")}
          </ServerSettingDescription>
        </View>
        <View className="flex-row items-center gap-3 py-3 pr-3 pl-4">
          <View className="min-w-0 flex-1 gap-1">
            <ServerSettingLabel>{t("mobile.server.settings.logo")}</ServerSettingLabel>
            <ServerSettingDescription>{t("mobile.server.settings.logoDescription")}</ServerSettingDescription>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(hasLogo ? "mobile.server.settings.editLogo" : "mobile.server.settings.addLogo")}
            accessibilityState={{ disabled: locked, busy: picking }}
            disabled={locked}
            onPress={editLogo}
            className="size-14 items-center justify-center overflow-hidden border border-grouped-border bg-control-active"
            style={({ pressed }) => ({ borderRadius: 14, opacity: locked ? 0.45 : pressed ? 0.6 : 1 })}
          >
            {hasLogo ? (
              <ServerAvatar
                server={{ ...server, name: trimmed || server.name }}
                size={54}
                showStatus={false}
                logoUri={logo === undefined ? undefined : (logo?.uri ?? null)}
              />
            ) : (
              <ImagePlus color={foreground} size={20} />
            )}
          </Pressable>
        </View>
      </ServerSettingsSection>
      {!available ? (
        <SettingsNote>
          {t(
            !canAdministerServer(server.role)
              ? "mobile.server.settings.identityNotAllowed"
              : server.state === "online"
                ? "mobile.server.settings.identityUnsupported"
                : "mobile.server.settings.identityOffline",
          )}
        </SettingsNote>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-1 text-danger-text" style={typeScale.caption}>
          {error}
        </Typography.Paragraph>
      ) : null}
      <SheetSaveAction
        dirty={dirty}
        canSave={nameValid && available}
        pending={saving || picking}
        onSave={() => void save()}
      />
    </>
  );
}
