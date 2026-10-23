import { router, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Cable from "lucide-react-native/icons/cable";
import Globe from "lucide-react-native/icons/globe";
import HardDrive from "lucide-react-native/icons/hard-drive";
import Plug from "lucide-react-native/icons/plug";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Settings from "lucide-react-native/icons/settings";
import Sparkles from "lucide-react-native/icons/sparkles";
import Users from "lucide-react-native/icons/users";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import {
  ServerSettingsContent,
  ServerSettingsRow,
  ServerSettingsSection,
} from "@/features/servers/components/server-settings-content";
import { useServerUpdate } from "@/features/servers/model/use-server-update";
import { SettingsNote } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/** The server overview opens only settings that this host and member can use. */
export function ServerSettingsScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const {
    servers,
    canManageConnectors,
    canManageOnePasswordConnector,
    canReadServerStorage,
    canManageProviders,
    canManageMcpServers,
    canViewHostedSites,
  } = useMobileWorkspace();
  const iconColor = String(useCSSVariable("--openbot-text-secondary"));
  const server = servers.find((item) => item.id === serverId);
  const update = useServerUpdate(serverId, { poll: false });
  const connectors = canManageConnectors(serverId) || canManageOnePasswordConnector(serverId);
  const icon = { size: 18, color: iconColor, strokeWidth: 1.75 };
  if (!server)
    return (
      <ServerSettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </ServerSettingsContent>
    );
  return (
    <ServerSettingsContent>
      <View className="gap-2">
        <Typography.Heading style={typeScale.teamLead}>{server.name}</Typography.Heading>
        <Typography.Paragraph className="text-muted" style={typeScale.teamMeta}>
          {t("mobile.server.route.settings")}
        </Typography.Paragraph>
      </View>
      <ServerSettingsSection title={t("mobile.server.settings.overviewTitle")}>
        <ServerSettingsRow
          label={t("mobile.server.settings.general")}
          icon={<Settings {...icon} />}
          onPress={() => router.push({ pathname: "/server-settings/general", params: { serverId } })}
        />
        <ServerSettingsRow
          label={t("mobile.server.settings.members")}
          icon={<Users {...icon} />}
          onPress={() => router.push({ pathname: "/server-settings/members", params: { serverId } })}
        />
        {canManageMcpServers(serverId) ? (
          <ServerSettingsRow
            label={t("mobile.server.settings.mcp")}
            icon={<Cable {...icon} />}
            onPress={() => router.push({ pathname: "/server-settings/mcp", params: { serverId } })}
          />
        ) : null}
        {canReadServerStorage(serverId) ? (
          <ServerSettingsRow
            label={t("mobile.server.settings.storage")}
            icon={<HardDrive {...icon} />}
            onPress={() => router.push({ pathname: "/server-settings/storage", params: { serverId } })}
          />
        ) : null}
        {canViewHostedSites(serverId) ? (
          <ServerSettingsRow
            label={t("mobile.server.settings.sites")}
            icon={<Globe {...icon} />}
            onPress={() => router.push({ pathname: "/server-settings/sites", params: { serverId } })}
          />
        ) : null}
        {canManageProviders(serverId) ? (
          <ServerSettingsRow
            label={t("mobile.server.settings.providers")}
            icon={<Sparkles {...icon} />}
            onPress={() => router.push({ pathname: "/server-settings/providers", params: { serverId } })}
          />
        ) : null}
        {update.access || update.query.data ? (
          <ServerSettingsRow
            label={t("mobile.server.settings.updates")}
            icon={<RefreshCw {...icon} />}
            onPress={() => router.push({ pathname: "/server-settings/updates", params: { serverId } })}
          />
        ) : null}
        {connectors ? (
          <ServerSettingsRow
            label={t("mobile.server.settings.connectors")}
            icon={<Plug {...icon} />}
            onPress={() => router.push({ pathname: "/server-settings/connectors", params: { serverId } })}
          />
        ) : null}
      </ServerSettingsSection>
    </ServerSettingsContent>
  );
}
