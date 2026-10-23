import { useThemeColor } from "heroui-native/hooks";
import Pencil from "lucide-react-native/icons/pencil";
import { Pressable, View } from "react-native";
import { InstructionsLimit } from "@/features/agents/components/instructions-limit";
import { TeamAgentAvatar } from "@/features/agents/components/team-agent-avatar";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { ProfileFields, ProfileIdentity } from "@/shared/components/profile-content";
import { useText } from "@/shared/lib/text";

export function AgentProfileHero({ agent, onAppearance }: { agent: MobileAgent; onAppearance: () => void }) {
  const { t } = useText();
  const ink = useThemeColor("background");
  return (
    <ProfileIdentity
      name={agent.name}
      title={agent.title}
      avatar={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.agent.edit.appearance")}
          onPress={onAppearance}
          style={({ pressed }) => ({ width: 96, height: 92, opacity: pressed ? 0.6 : 1 })}
        >
          <TeamAgentAvatar agent={agent} size={84} />
          <View
            className="absolute items-center justify-center rounded-full border-team-canvas bg-foreground"
            style={{ width: 44, height: 44, borderWidth: 3, left: 52, top: 48 }}
          >
            <Pencil size={17} color={ink} />
          </View>
        </Pressable>
      }
    />
  );
}

export function AgentProfileFields({
  name,
  title,
  description,
  disabled,
  onChange,
}: {
  name: string;
  title: string;
  description: string;
  disabled: boolean;
  onChange: (value: { name?: string; title?: string; description?: string }) => void;
}) {
  const { t } = useText();
  return (
    <ProfileFields
      name={name}
      title={title}
      instructions={description}
      disabled={disabled}
      labels={{
        name: t("mobile.agent.form.name"),
        title: t("mobile.agent.edit.title"),
        titlePlaceholder: t("mobile.agent.edit.titlePlaceholder"),
        instructions: t("mobile.agent.edit.instructions"),
        instructionsPlaceholder: t("mobile.agent.edit.instructionsPlaceholder"),
      }}
      instructionsFooter={<InstructionsLimit text={description} />}
      onChange={({ instructions, ...values }) =>
        onChange({ ...values, ...(instructions !== undefined ? { description: instructions } : {}) })
      }
    />
  );
}
