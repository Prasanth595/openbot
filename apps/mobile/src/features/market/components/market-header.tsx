import { SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ListFilter from "lucide-react-native/icons/list-filter";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { MenuView } from "@/shared/components/menu-view";
import { NativeSegmentedControl } from "@/shared/components/native-segmented-control";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export type MarketTab = "agents" | "apps" | "skills";
const TABS = ["agents", "apps", "skills"] as const;
const TAB_LABELS = {
  agents: "mobile.market.agents",
  apps: "mobile.market.apps",
  skills: "mobile.market.skills",
} as const satisfies Record<MarketTab, MobileTextKey>;
const CATEGORY_LABELS = {
  coding: "mobile.market.categories.coding",
  design: "mobile.market.categories.design",
  "data-analytics": "mobile.market.categories.dataAnalytics",
  documents: "mobile.market.categories.documents",
  productivity: "mobile.market.categories.productivity",
  research: "mobile.market.categories.research",
  automation: "mobile.market.categories.automation",
  other: "mobile.market.categories.other",
} as const satisfies Record<SkillCategory, MobileTextKey>;

export function MarketHeader({
  tab,
  query,
  category,
  featuredOnly,
  onTabChange,
  onQueryChange,
  onCategoryChange,
  onFeaturedChange,
}: {
  tab: MarketTab;
  query: string;
  category: SkillCategory | undefined;
  featuredOnly: boolean;
  onTabChange: (tab: MarketTab) => void;
  onQueryChange: (query: string) => void;
  onCategoryChange: (category: SkillCategory | undefined) => void;
  onFeaturedChange: (featured: boolean) => void;
}) {
  const { t } = useText();
  const foreground = useThemeColor("foreground");
  const search = useRef<SearchBarCommands | null>(null);
  const searchTab = useRef<MarketTab | null>(null);
  useEffect(() => {
    if (searchTab.current === tab) return;
    searchTab.current = tab;
    search.current?.setText(query);
  }, [tab, query]);
  const filters = [
    { id: "all", title: t("mobile.market.allCategories"), state: category === undefined ? "on" : "off" },
    ...SKILL_CATEGORIES.map((value) => ({
      id: value,
      title: t(CATEGORY_LABELS[value]),
      state: category === value ? ("on" as const) : ("off" as const),
    })),
    { id: "featured", title: t("mobile.market.featuredOnly"), state: featuredOnly ? "on" : "off" },
  ] as const;
  const selectFilter = (id: string) => {
    void haptics.selection();
    if (id === "featured") onFeaturedChange(!featuredOnly);
    else onCategoryChange(SKILL_CATEGORIES.find((value) => value === id));
  };
  return (
    <View style={{ gap: 16, paddingBottom: 16 }}>
      <Stack.Title large={false}>{t("mobile.market.title")}</Stack.Title>
      <Stack.SearchBar
        ref={search}
        placeholder={t("mobile.market.search")}
        autoCapitalize="none"
        hideWhenScrolling={false}
        onChangeText={({ nativeEvent }) => onQueryChange(nativeEvent.text)}
        onCancelButtonPress={() => onQueryChange("")}
        onClose={() => onQueryChange("")}
      />
      {isAndroid ? (
        // Android toolbar menus require an image source; keep the shared menu adapter and Lucide trigger.
        <Stack.Screen
          options={{
            headerRight: () => (
              <MenuView
                title={t("mobile.market.filters")}
                actions={[...filters]}
                onPressAction={({ nativeEvent }) => selectFilter(nativeEvent.event)}
              >
                <View
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.market.filters")}
                  className="size-12 items-center justify-center"
                >
                  <ListFilter size={22} color={String(foreground)} />
                </View>
              </MenuView>
            ),
          }}
        />
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="line.3.horizontal.decrease" accessibilityLabel={t("mobile.market.filters")}>
            {filters.map((filter) => (
              <Stack.Toolbar.MenuAction
                key={filter.id}
                isOn={filter.state === "on"}
                onPress={() => selectFilter(filter.id)}
              >
                {filter.title}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
      <Typography.Paragraph className="text-muted" style={typeScale.teamMeta}>
        {t("mobile.market.subtitle")}
      </Typography.Paragraph>
      <NativeSegmentedControl
        options={TABS.map((value) => ({ value, label: t(TAB_LABELS[value]) }))}
        value={tab}
        onChange={(value) => {
          void haptics.selection();
          onTabChange(value);
        }}
      />
    </View>
  );
}
