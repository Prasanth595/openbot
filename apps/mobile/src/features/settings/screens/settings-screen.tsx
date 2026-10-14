import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { useUniwind } from "uniwind";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { localAgentsPreference, useLocalAgentsPreference } from "@/features/settings/model/local-agents";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export function SettingsScreen() {
  const { session } = useMobileSession();
  const { t } = useText();
  const { theme } = useUniwind();
  const localAgents = useLocalAgentsPreference();
  const [localAgentsError, setLocalAgentsError] = useState<string | null>(null);
  const displayName = session ? mobileUserName(session.user) : t("mobile.settings.home.profile");
  function saveLocalAgents(enabled: boolean) {
    setLocalAgentsError(null);
    void localAgentsPreference.save(enabled).catch(() => setLocalAgentsError(t("mobile.settings.saveFailed")));
  }
  return (
    <SettingsContent>
      <SettingsSection>
        <SettingsRow
          onPress={() => router.push("/settings/profile")}
          supportingText={session?.user.email}
          leading={
            <ProfileAvatar
              neutral
              name={displayName}
              imageUrl={session?.user.avatarUrl ? new URL(session.user.avatarUrl, session.apiUrl).toString() : null}
              size={40}
            />
          }
        >
          <Typography.Paragraph type="body-sm">{displayName}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.home.preferences")}>
        <SettingsRow onPress={() => router.push("/settings/appearance")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.appearance.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/animations")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.animations.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/language")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.language.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/haptics")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.feedback.haptics")}</Typography.Paragraph>
        </SettingsRow>
        {/* Notifications come through Apple, and Live Activities exist only on iOS. One screen has both. */}
        {isIOS ? (
          <SettingsRow onPress={() => router.push("/settings/notifications")}>
            <Typography.Paragraph type="body-sm">{t("mobile.settings.notifications.title")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        <SettingsRow onPress={() => router.push("/settings/privacy")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.privacy.title")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        footer={
          localAgents.loadFailed
            ? t("mobile.settings.localAgents.loadFailed")
            : (localAgentsError ?? t("mobile.settings.localAgents.footer"))
        }
      >
        <SettingsRow>
          <SettingsSwitch
            value={localAgents.enabled}
            disabled={!localAgents.ready || localAgents.saving}
            label={t("mobile.settings.localAgents.toggle")}
            dark={theme === "dark"}
            onValueChange={saveLocalAgents}
          />
        </SettingsRow>
        {localAgents.loadFailed ? (
          <SettingsRow disclosure={false} onPress={() => void localAgentsPreference.load().catch(() => undefined)}>
            <Typography.Paragraph>{t("common.tryAgain")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.conversations.title")}>
        <SettingsRow onPress={() => router.push("/settings/hidden-chats")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.conversations.hiddenChats")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          onPress={() => router.push("/settings/support")}
          supportingText={t("mobile.settings.home.supportHint")}
        >
          <Typography.Paragraph type="body-sm">{t("mobile.settings.home.support")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow onPress={() => router.push("/settings/about")}>
          <Typography.Paragraph type="body-sm">{t("mobile.settings.home.about")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
