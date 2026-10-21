import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Plus from "lucide-react-native/icons/plus";
import { SERVER_ROLE_LABEL_KEYS } from "@/features/servers/model/server-role";
import { useServerMembers } from "@/features/servers/model/use-server-members";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/**
 * Server sheet > Members: the people of the server and the email invitations that wait for an
 * answer. An owner or admin opens a person to manage them, and invites people with the header "+".
 */
export function ServerMembersScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { server, canManage, members, invites, activeMembers, pendingInvites, memberLimit } =
    useServerMembers(serverId);
  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const invited = pendingInvites?.filter((invite) => invite.email) ?? [];
  const label = (role: string) => (
    <Typography.Paragraph className="text-grouped-secondary">{role}</Typography.Paragraph>
  );
  return (
    <SettingsContent>
      {canManage ? (
        <InviteAction onPress={() => router.push({ pathname: "/server-settings/invite", params: { serverId } })} />
      ) : null}
      <SettingsSection
        title={
          activeMembers
            ? t("mobile.server.members.limitCount", { count: activeMembers.length, limit: memberLimit })
            : undefined
        }
        footer={
          members.isError
            ? t("mobile.server.members.loadFailed")
            : invites.isError
              ? t("mobile.server.members.invitationsLoadFailed")
              : undefined
        }
      >
        {members.isPending && !members.isError ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.members.loading")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {activeMembers?.map((member) => {
          const name = member.name || member.email;
          const self = member.membershipId === server.membershipId;
          return (
            <SettingsRow
              key={member.membershipId}
              disclosure={false}
              leading={<ProfileAvatar neutral name={name} size={36} />}
              trailing={label(t(SERVER_ROLE_LABEL_KEYS[member.role]))}
              accessibilityLabel={t("mobile.server.members.rowLabel", {
                name,
                role: t(SERVER_ROLE_LABEL_KEYS[member.role]),
              })}
              onPress={() =>
                router.push({
                  pathname: "/server-settings/member",
                  params: { serverId, membershipId: member.membershipId },
                })
              }
            >
              <Typography.Paragraph numberOfLines={1}>
                {self ? t("mobile.server.members.you", { name }) : name}
              </Typography.Paragraph>
            </SettingsRow>
          );
        })}
        {invited.map((invite) => (
          <SettingsRow
            key={invite.inviteId}
            disclosure={false}
            leading={<ProfileAvatar neutral name={invite.email ?? ""} size={36} />}
            trailing={label(t("mobile.server.members.invited"))}
            accessibilityLabel={t("mobile.server.members.rowLabel", {
              name: invite.email ?? "",
              role: t("mobile.server.members.invited"),
            })}
            onPress={() =>
              router.push({ pathname: "/server-settings/member", params: { serverId, inviteId: invite.inviteId } })
            }
          >
            <Typography.Paragraph numberOfLines={1}>{invite.email}</Typography.Paragraph>
          </SettingsRow>
        ))}
        {members.isSuccess && activeMembers?.length === 0 && invited.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.members.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {members.isError || invites.isError ? (
          <SettingsRow
            disclosure={false}
            disabled={members.isFetching || invites.isFetching}
            onPress={() => {
              void members.refetch();
              if (canManage) void invites.refetch();
            }}
          >
            <Typography.Paragraph className="text-accent">{t("mobile.server.members.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}

/** The "+" of the header: the native toolbar on iOS. */
function InviteAction({ onPress }: { onPress: () => void }) {
  const { t } = useText();
  const press = () => {
    void haptics.impact("light");
    onPress();
  };
  if (isAndroid)
    return (
      <AndroidHeaderButton
        placement="right"
        icon={Plus}
        accessibilityLabel={t("mobile.server.members.invitePeople")}
        onPress={press}
      />
    );
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon={isIOS ? "plus" : undefined}
        accessibilityLabel={t("mobile.server.members.invitePeople")}
        onPress={press}
      >
        {isIOS ? undefined : "+"}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}
