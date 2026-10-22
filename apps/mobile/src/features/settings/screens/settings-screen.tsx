import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ListGroup, Typography } from "heroui-native";
import Bell from "lucide-react-native/icons/bell";
import ChartLine from "lucide-react-native/icons/chart-line";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import EyeOff from "lucide-react-native/icons/eye-off";
import Info from "lucide-react-native/icons/info";
import Languages from "lucide-react-native/icons/languages";
import LifeBuoy from "lucide-react-native/icons/life-buoy";
import LockKeyhole from "lucide-react-native/icons/lock-keyhole";
import MessagesSquare from "lucide-react-native/icons/messages-square";
import Server from "lucide-react-native/icons/server";
import Shield from "lucide-react-native/icons/shield";
import Sparkles from "lucide-react-native/icons/sparkles";
import SunMoon from "lucide-react-native/icons/sun-moon";
import Vibrate from "lucide-react-native/icons/vibrate";
import { useState } from "react";
import { Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";
import { lastUsageDays } from "@/features/agents/components/usage-range-picker";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  SettingsHomeRow,
  SettingsHomeSection,
  SettingsHomeTile,
} from "@/features/settings/components/settings-home-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const DISCORD_URL = "https://discord.openbot.run";

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useMobileSession();
  const { t, format } = useText();
  const queryScope = useQueryScope();
  const { activeServer, loadHostAnalytics } = useMobileWorkspace();
  const [range] = useState(() => lastUsageDays());
  const [linkError, setLinkError] = useState<string | null>(null);
  const blue = String(useCSSVariable("--openbot-unread-surface"));
  const ink = String(useCSSVariable("--openbot-text-on-light"));
  const displayName = session ? mobileUserName(session.user) : t("mobile.settings.home.profile");
  const imageUrl = session?.user.avatarUrl ? new URL(session.user.avatarUrl, session.apiUrl).toString() : null;
  const usage = useQuery({
    queryKey: queryKeys.serverUsage(queryScope, activeServer.id, range, undefined),
    queryFn: () => loadHostAnalytics(range, activeServer.id),
    enabled: activeServer.state === "online",
    staleTime: 60_000,
    retry: false,
  });
  const cost = usage.data?.totals.estimatedCostUsd;
  const usageSummary =
    cost == null
      ? t("mobile.agent.usage.days", { count: 30 })
      : t("mobile.settings.home.usageSummary", { cost: format.currencyUsd(cost) });
  return (
    <View className="flex-1 bg-team-canvas" style={{ paddingTop: isAndroid ? insets.top : 0 }}>
      <SheetScrollView
        className="bg-team-canvas"
        scrollEdgeEffect={false}
        contentContainerClassName="gap-5 px-5 pt-2 pb-10"
      >
        <Typography.Heading style={typeScale.teamDisplay}>{t("mobile.app.route.settings")}</Typography.Heading>
        <ListGroup.Item
          accessibilityRole="button"
          className="flex-row items-center"
          style={({ pressed }) => ({
            paddingVertical: 14,
            paddingLeft: 14,
            paddingRight: 8,
            borderRadius: 24,
            gap: 14,
            backgroundColor: blue,
            opacity: pressed ? 0.6 : 1,
          })}
          onPress={() => {
            void haptics.impact("soft");
            router.push("/settings/profile");
          }}
        >
          <View
            className="size-12 items-center justify-center overflow-hidden rounded-full"
            style={{ backgroundColor: ink }}
          >
            {imageUrl ? (
              <ProfileAvatar name={displayName} imageUrl={imageUrl} accent={blue} size={48} />
            ) : (
              <Typography.Paragraph
                style={{
                  fontFamily: "Inter",
                  fontSize: 28,
                  lineHeight: 34,
                  fontWeight: "500",
                  letterSpacing: -1.4,
                  color: blue,
                }}
              >
                {Array.from(displayName.trim())[0]?.toUpperCase()}
              </Typography.Paragraph>
            )}
          </View>
          <View className="min-w-0 flex-1" style={{ gap: 2 }}>
            <Typography.Paragraph
              numberOfLines={1}
              weight="semibold"
              style={{ fontFamily: "Inter", fontSize: 17, lineHeight: 22, color: ink }}
            >
              {displayName}
            </Typography.Paragraph>
            {session?.user.email ? (
              <Typography.Paragraph
                numberOfLines={1}
                style={{ fontFamily: "Inter", fontSize: 13, lineHeight: 17, color: ink, opacity: 0.6 }}
              >
                {session.user.email}
              </Typography.Paragraph>
            ) : null}
          </View>
          <View className="size-11 items-center justify-center">
            <ChevronRight size={20} color={ink} />
          </View>
        </ListGroup.Item>
        <SettingsHomeSection title={t("mobile.settings.home.server")}>
          <SettingsHomeRow
            title={activeServer.name}
            subtitle={t("mobile.settings.home.serverHint")}
            icon={Server}
            onPress={() => router.push({ pathname: "/server-settings", params: { serverId: activeServer.id } })}
          />
          <SettingsHomeRow
            title={t("mobile.app.route.usage")}
            subtitle={usageSummary}
            icon={ChartLine}
            onPress={() => router.push({ pathname: "/server-usage", params: { serverId: activeServer.id } })}
          />
        </SettingsHomeSection>
        <SettingsHomeSection title={t("mobile.settings.home.preferences")}>
          <View className="flex-row" style={{ gap: 10 }}>
            <SettingsHomeTile
              title={t("mobile.settings.appearance.title")}
              index={1}
              icon={SunMoon}
              onPress={() => router.push("/settings/appearance")}
            />
            <SettingsHomeTile
              title={t("mobile.settings.animations.title")}
              index={2}
              icon={Sparkles}
              onPress={() => router.push("/settings/animations")}
            />
          </View>
          <View className="flex-row" style={{ gap: 10 }}>
            <SettingsHomeTile
              title={t("mobile.settings.language.title")}
              index={3}
              icon={Languages}
              onPress={() => router.push("/settings/language")}
            />
            <SettingsHomeTile
              title={t("mobile.settings.feedback.haptics")}
              index={4}
              icon={Vibrate}
              onPress={() => router.push("/settings/haptics")}
            />
          </View>
          <View className="flex-row" style={{ gap: 10 }}>
            <SettingsHomeTile
              title={t("mobile.settings.notifications.title")}
              index={5}
              icon={Bell}
              onPress={() => router.push("/settings/notifications")}
            />
            <SettingsHomeTile
              title={t("mobile.settings.privacy.title")}
              index={6}
              icon={Shield}
              onPress={() => router.push("/settings/privacy")}
            />
          </View>
          <SettingsHomeRow
            title={t("mobile.appLock.title")}
            icon={LockKeyhole}
            onPress={() => router.push("/settings/app-lock")}
          />
        </SettingsHomeSection>
        <SettingsHomeSection title={t("mobile.settings.conversations.title")}>
          <SettingsHomeRow
            title={t("mobile.settings.conversations.hiddenChats")}
            icon={EyeOff}
            onPress={() => router.push("/settings/hidden-chats")}
          />
        </SettingsHomeSection>
        <SettingsHomeSection title={t("mobile.settings.home.help")}>
          <SettingsHomeRow
            title={t("mobile.settings.home.support")}
            subtitle={t("mobile.settings.home.supportHint")}
            icon={LifeBuoy}
            onPress={() => router.push("/settings/support")}
          />
          <SettingsHomeRow
            title={t("mobile.settings.home.discord")}
            subtitle={t("mobile.settings.home.communityHint")}
            icon={MessagesSquare}
            onPress={() => {
              setLinkError(null);
              void Linking.openURL(DISCORD_URL).catch(() => setLinkError(t("mobile.settings.about.openFailed")));
            }}
          />
          <SettingsHomeRow
            title={t("mobile.settings.home.about")}
            icon={Info}
            onPress={() => router.push("/settings/about")}
          />
          {linkError ? (
            <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
              {linkError}
            </Typography.Paragraph>
          ) : null}
        </SettingsHomeSection>
      </SheetScrollView>
      <View pointerEvents="none" className="absolute inset-x-0 top-0 bg-team-canvas" style={{ height: insets.top }} />
    </View>
  );
}
