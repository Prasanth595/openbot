import { Redirect, Stack } from "expo-router";
import { useState } from "react";
import { Alert, FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";
import {
  TeamAgentSummary,
  TeamHeader,
  TeamLeadCard,
  TeamMoreIcon,
  TeamOrb,
  TeamSectionHeading,
  TeamTitle,
} from "@/features/agents/components/team-home-parts";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

// B01 sample content is isolated from workspace storage and is never shown in a release build.
const agents: [MobileAgent, ...MobileAgent[]] = [
  {
    id: "lead",
    serverId: "preview",
    name: "Atlas",
    title: "Lead agent",
    description: "",
    preview: "The project outline is ready for review.",
    updatedLabel: "2:22 PM",
    avatarSeed: "atlas",
    avatarHue: 150,
  },
  {
    id: "research",
    serverId: "preview",
    name: "Research",
    title: "",
    description: "",
    preview: "I found three useful references.",
    updatedLabel: "2:29 PM",
    avatarSeed: "research",
    avatarHue: 185,
  },
  {
    id: "fitness",
    serverId: "preview",
    name: "Planning",
    title: "",
    description: "",
    preview: "The next steps are ready.",
    updatedLabel: "2:22 PM",
    avatarSeed: "fitness",
    avatarHue: 320,
  },
  {
    id: "finance",
    serverId: "preview",
    name: "Writing",
    title: "",
    description: "",
    preview: "Here is the revised introduction.",
    updatedLabel: "2:22 PM",
    avatarSeed: "finance",
    avatarHue: 150,
  },
  {
    id: "cto",
    serverId: "preview",
    name: "Engineering",
    title: "",
    description: "",
    preview: "Both checks passed.",
    updatedLabel: "2:22 PM",
    avatarSeed: "cto",
    avatarHue: 0,
  },
  {
    id: "design",
    serverId: "preview",
    name: "Design",
    title: "",
    description: "",
    preview: "The updated layout is ready.",
    updatedLabel: "2:22 PM",
    avatarSeed: "design",
    avatarHue: 215,
  },
  {
    id: "openbot",
    serverId: "preview",
    name: "Openbot",
    title: "",
    description: "",
    preview: "The review is complete.",
    updatedLabel: "2:22 PM",
    avatarSeed: "openbot",
    avatarHue: 30,
  },
];

const sections = [
  { id: "agents", name: "Agents", agents: agents.slice(1, 4), hasLead: true },
  { id: "coding", name: "Coding", agents: agents.slice(4), hasLead: false },
];

export function TeamDesignPreviewScreen() {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const border = String(useCSSVariable("--openbot-border-grouped"));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const explainPreview = () => Alert.alert(t("mobile.agent.team.previewTitle"), t("mobile.agent.team.previewBody"));
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <View className="flex-1 bg-team-canvas">
      <TeamHeader
        name="Openbot"
        onWorkspace={explainPreview}
        onSearch={explainPreview}
        options={
          <Stack.Toolbar.View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.agent.home.chatOptions")}
              onPress={explainPreview}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <TeamMoreIcon />
            </Pressable>
          </Stack.Toolbar.View>
        }
      />
      <FlatList
        data={sections}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="never"
        alwaysBounceVertical={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        ListHeaderComponent={
          <>
            <TeamTitle agents={7} groups={2} />
            <TeamLeadCard agent={agents[0]} total={7} onOpen={explainPreview} />
          </>
        }
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <TeamSectionHeading
              name={item.name}
              count={item.agents.length}
              hasLead={item.hasLead}
              collapsed={collapsed.has(item.id)}
              onToggle={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })
              }
              menu={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.agent.section.options", { name: item.name })}
                  onPress={explainPreview}
                  style={{ width: 40, height: 44, alignItems: "flex-end", justifyContent: "center", opacity: 0.6 }}
                >
                  <TeamMoreIcon />
                </Pressable>
              }
            />
            {collapsed.has(item.id)
              ? null
              : item.agents.map((agent) => (
                  <Pressable
                    key={agent.id}
                    accessibilityRole="button"
                    accessibilityLabel={t("mobile.agent.list.open", { name: agent.name })}
                    onPress={explainPreview}
                    style={{
                      minHeight: 73,
                      borderTopWidth: 1,
                      borderTopColor: border,
                      paddingVertical: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <TeamOrb hue={agent.avatarHue} seed={agent.avatarSeed} />
                    <TeamAgentSummary agent={agent} />
                  </Pressable>
                ))}
          </View>
        )}
      />
    </View>
  );
}
