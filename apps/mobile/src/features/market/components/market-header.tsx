import { SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Button, Input, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ListFilter from "lucide-react-native/icons/list-filter";
import Search from "lucide-react-native/icons/search";
import { View } from "react-native";
import { MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
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
  const [foreground, muted] = useThemeColor(["foreground", "muted"]);
  return (
    <View style={{ gap: 16, paddingBottom: 16 }}>
      <View style={{ gap: 8 }}>
        <Typography.Heading style={typeScale.teamDisplay}>{t("mobile.market.title")}</Typography.Heading>
        <Typography.Paragraph className="text-muted uppercase" style={typeScale.teamMeta}>
          {t("mobile.market.subtitle")}
        </Typography.Paragraph>
      </View>
      <View
        className="flex-row gap-1 rounded-full border border-grouped-border bg-grouped p-1"
        style={{ minHeight: 40 }}
      >
        {TABS.map((item) => (
          <Button
            key={item}
            variant="ghost"
            className={`h-auto min-h-8 flex-1 rounded-full px-1 py-1 ${tab === item ? "bg-action" : ""}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === item }}
            onPress={() => {
              void haptics.selection();
              onTabChange(item);
            }}
          >
            <Button.Label
              className={tab === item ? "text-action-foreground" : "text-muted"}
              style={typeScale.marketLabel}
            >
              {t(TAB_LABELS[item])}
            </Button.Label>
          </Button>
        ))}
      </View>
      <View className="flex-row items-center gap-2">
        <View
          className="min-w-0 flex-1 flex-row items-center gap-2.5 rounded-full border border-grouped-border bg-grouped px-3.5"
          style={{ minHeight: 44 }}
        >
          <Search size={18} color={String(muted)} />
          <Input
            variant="secondary"
            accessibilityLabel={t("mobile.market.search")}
            placeholder={t("mobile.market.search")}
            value={query}
            onChangeText={onQueryChange}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            background={null}
            className="min-h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0 shadow-none"
            style={{ fontFamily: "Inter", fontSize: 16 }}
          />
        </View>
        <MenuView
          title={t("mobile.market.filters")}
          actions={[
            { id: "all", title: t("mobile.market.allCategories"), state: category === undefined ? "on" : "off" },
            ...SKILL_CATEGORIES.map((value) => ({
              id: value,
              title: t(CATEGORY_LABELS[value]),
              state: category === value ? ("on" as const) : ("off" as const),
            })),
            { id: "featured", title: t("mobile.market.featuredOnly"), state: featuredOnly ? "on" : "off" },
          ]}
          onPressAction={({ nativeEvent }) => {
            void haptics.selection();
            if (nativeEvent.event === "featured") onFeaturedChange(!featuredOnly);
            else onCategoryChange(SKILL_CATEGORIES.find((value) => value === nativeEvent.event));
          }}
        >
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={t("mobile.market.filters")}
            className="size-11 items-center justify-center rounded-full border border-border bg-control"
          >
            <ListFilter size={20} color={String(category || featuredOnly ? foreground : muted)} />
          </View>
        </MenuView>
      </View>
    </View>
  );
}
