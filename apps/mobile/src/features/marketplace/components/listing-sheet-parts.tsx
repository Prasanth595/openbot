import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import Plus from "lucide-react-native/icons/plus";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useUniwind } from "uniwind";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import type { MarketplaceListing } from "../model/marketplace-listings";
import { ListingGradient } from "./listing-gradient";
import { ListingIcon, useListingSubtitle } from "./marketplace-parts";

/**
 * The add action of a listing sheet, in the native header: `+` to install, or the arrows of an update.
 * A skill or an app that needs a key opens the next page of the sheet from it.
 */
export function ListingHeaderAction({
  kind,
  hidden,
  pending,
  label,
  onPress,
}: {
  kind: "add" | "update";
  hidden: boolean;
  pending: boolean;
  label: string;
  onPress: () => void;
}) {
  const icon: LucideIcon = kind === "update" ? RotateCw : Plus;
  const press = () => {
    if (hidden || pending) return;
    void haptics.impact("light");
    onPress();
  };
  if (isAndroid)
    return (
      <AndroidHeaderButton
        placement="right"
        icon={icon}
        hidden={hidden}
        disabled={pending}
        accessibilityLabel={label}
        onPress={press}
      />
    );
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        hidden={hidden}
        disabled={pending}
        icon={isIOS ? (kind === "update" ? "arrow.clockwise" : "plus") : undefined}
        accessibilityLabel={label}
        onPress={press}
      >
        {isIOS ? label : "+"}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

/** The icon, name, creator and kind of a listing, at the top of its sheet. */
export function ListingTitle({ listing }: { listing: MarketplaceListing }) {
  const { t } = useText();
  const subtitle = useListingSubtitle()(listing, true);
  return (
    <View className="flex-row items-center gap-4">
      <Stack.Screen options={{ title: listing.name }} />
      <ListingIcon listing={listing} size={64} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Typography.Heading type="h3" numberOfLines={2}>
          {listing.name}
        </Typography.Heading>
        <Typography.Paragraph type="body-sm" numberOfLines={1} className="text-grouped-secondary">
          {t("mobile.marketplace.listing.creator", { name: listing.creatorName })}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-xs" numberOfLines={1} className="text-grouped-secondary">
          {subtitle}
        </Typography.Paragraph>
      </View>
    </View>
  );
}

/**
 * The listing's gradient, as the desktop page shows it, with what the listing does on it: an example
 * request in a message field for a skill or an app, or the skills an agent brings.
 */
export function ListingHero({ listing, children }: { listing: MarketplaceListing; children: ReactNode }) {
  return (
    <View
      accessibilityElementsHidden={false}
      className="overflow-hidden rounded-3xl px-4 py-9"
      style={{ borderCurve: "continuous" }}
    >
      <ListingGradient name={listing.name} />
      {children}
    </View>
  );
}

/** The agents a Try can open, and what it does. No agents turns it off. */
export interface TryTargets {
  agents: readonly { id: string; name: string }[];
  onTry: (agentId: string) => void;
}

/**
 * Opens a Try: one agent opens its chat at once, and more agents ask which one, in a native menu. The
 * child is the control the user presses.
 */
export function TryPressable({
  targets,
  label,
  children,
}: {
  targets: TryTargets;
  label: string;
  children: ReactNode;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const [only] = targets.agents;
  if (targets.agents.length > 1)
    return (
      <MenuView
        colorScheme={theme === "dark" ? "dark" : "light"}
        title={t("mobile.marketplace.try.choose")}
        actions={targets.agents.map((agent): MenuAction => ({ id: agent.id, title: agent.name }))}
        onPressAction={({ nativeEvent }) => targets.onTry(nativeEvent.event)}
      >
        <View accessible accessibilityRole="button" accessibilityLabel={label}>
          {children}
        </View>
      </MenuView>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !only }}
      disabled={!only}
      style={({ pressed }) => ({ opacity: !only ? 0.4 : pressed ? 0.6 : 1 })}
      onPress={() => {
        if (only) targets.onTry(only.id);
      }}
    >
      {children}
    </Pressable>
  );
}

/**
 * An example request, as the chat field writes it: the listing's chip, then the words. With `targets`
 * it has the Try arrow of the desktop card, which puts the request in an agent's message field.
 */
export function HeroRequest({
  listing,
  text,
  targets,
  caption,
}: {
  listing: MarketplaceListing;
  text: string;
  targets?: TryTargets;
  /** Why the arrow is off, such as a skill that no agent has yet. */
  caption?: string | null;
}) {
  const { t } = useText();
  const only = targets?.agents.length === 1 ? targets.agents[0] : undefined;
  const label = only ? t("mobile.marketplace.try.in", { name: only.name }) : t("mobile.marketplace.try.label");
  return (
    <View className="gap-3">
      <View
        className="flex-row items-end gap-3 rounded-2xl py-3.5 pr-3 pl-4"
        style={{ backgroundColor: "rgba(20, 20, 20, 0.86)", borderCurve: "continuous" }}
      >
        <View className="min-w-0 flex-1 gap-2">
          <View
            className="flex-row items-center gap-1.5 self-start rounded-lg py-1 pr-2 pl-1"
            style={{ backgroundColor: "rgba(66, 160, 255, 0.18)" }}
          >
            <ListingIcon listing={listing} size={18} />
            <Typography.Paragraph numberOfLines={1} style={{ ...typeScale.caption, color: "#7cbcff" }}>
              {listing.name}
            </Typography.Paragraph>
          </View>
          <Typography.Paragraph style={{ ...typeScale.body, color: "#ffffff" }}>{text}</Typography.Paragraph>
        </View>
        {targets ? (
          <TryPressable targets={targets} label={label}>
            <View
              className="h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: "rgba(255, 255, 255, 0.14)" }}
            >
              <ArrowRight color="#ffffff" size={20} strokeWidth={2.2} />
            </View>
          </TryPressable>
        ) : null}
      </View>
      {caption ? (
        <Typography.Paragraph align="center" style={{ ...typeScale.caption, color: "rgba(255, 255, 255, 0.9)" }}>
          {caption}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

/** Short words on the gradient, such as the skills of an agent. */
export function HeroChips({ items }: { items: readonly string[] }) {
  return (
    <View className="flex-row flex-wrap justify-center gap-2">
      {items.map((item) => (
        <View key={item} className="rounded-full px-3 py-1.5" style={{ backgroundColor: "rgba(20, 20, 20, 0.62)" }}>
          <Typography.Paragraph numberOfLines={1} style={{ ...typeScale.caption, color: "#ffffff" }}>
            {item}
          </Typography.Paragraph>
        </View>
      ))}
    </View>
  );
}

/**
 * The properties of a listing in one row, as an app store shows them: a small label over each value,
 * between hairlines. A long row scrolls sideways.
 */
export function ListingFacts({ facts }: { facts: readonly { label: string; value: string }[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-1">
      {facts.map((fact, index) => (
        <View
          key={fact.label}
          accessible
          accessibilityLabel={`${fact.label}: ${fact.value}`}
          className={`min-w-24 items-center gap-1 px-4 ${index > 0 ? "border-l border-grouped-border" : ""}`}
        >
          <Typography.Paragraph type="body-xs" numberOfLines={1} className="text-grouped-secondary">
            {fact.label}
          </Typography.Paragraph>
          <Typography.Paragraph numberOfLines={1} className="font-semibold" style={typeScale.body}>
            {fact.value}
          </Typography.Paragraph>
        </View>
      ))}
    </ScrollView>
  );
}

/** A heading over a block of a listing sheet. */
export function ListingBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2.5">
      <Typography.Heading type="h4">{title}</Typography.Heading>
      {children}
    </View>
  );
}
