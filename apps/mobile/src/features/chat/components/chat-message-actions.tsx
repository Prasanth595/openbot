import { type ConversationReaction, MESSAGE_REACTIONS, MORE_MESSAGE_REACTIONS } from "@openbot/contracts/ipc";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Check, Copy, Plus, Reply, SmilePlus, TextSelect } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useCopyMessage } from "./use-copy-message";

const PICKER_IN = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const PICKER_OUT = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
const ICON_SIZE = 18;

/**
 * The row under a message: its reactions, Copy, React, Reply, Select text and the time. A phone has
 * no hover, so the row always shows, and each action takes one tap.
 */
export function ChatMessageActions({
  align,
  copyText,
  createdAt,
  reactions,
  agentsById,
  onReact,
  onReply,
  onSelectText,
  selecting = false,
}: {
  align: "start" | "end";
  /** The text that Copy puts on the clipboard. Empty for a message of files only. */
  copyText: string;
  createdAt?: string;
  reactions?: readonly ConversationReaction[];
  agentsById: ReadonlyMap<string, MobileAgent>;
  /** Unset where a reaction cannot be saved. `null` removes the reader's reaction. */
  onReact?: (emoji: string | null) => Promise<void>;
  onReply?: () => void;
  /** Starts the selection of the text in the bubble, or ends it while `selecting`. */
  onSelectText?: () => void;
  selecting?: boolean;
}) {
  const { t, format } = useText();
  const [mutedColor, foregroundColor] = useThemeColor(["muted", "foreground"]);
  const muted = String(mutedColor);
  const { copy, copied } = useCopyMessage(copyText);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moreEmoji, setMoreEmoji] = useState(false);
  // The reader's reaction shows at once. The host sends the saved list after it, and that list wins.
  const [pending, setPending] = useState<{
    emoji: string | null;
    over: readonly ConversationReaction[] | undefined;
  } | null>(null);
  const shown =
    pending && pending.over === reactions
      ? [
          ...(pending.emoji ? [{ emoji: pending.emoji, actor: { kind: "user" as const } }] : []),
          ...(reactions ?? []).filter((reaction) => reaction.actor.kind !== "user"),
        ]
      : (reactions ?? []);
  const own = shown.find((reaction) => reaction.actor.kind === "user")?.emoji ?? null;

  const react = (emoji: string | null) => {
    if (!onReact) return;
    setPickerOpen(false);
    setMoreEmoji(false);
    setPending({ emoji, over: reactions });
    void haptics.selection();
    onReact(emoji).catch((error: unknown) => {
      setPending(null);
      void haptics.notification("error");
      showFailureAlert(error, "turn", t("mobile.chat.message.reactionFailed"), t("mobile.chat.copyFailedMessage"));
    });
  };
  const time = createdAt ? format.date(new Date(createdAt), { timeStyle: "short" }) : null;

  return (
    // The space under the row sets each message apart from the next one. Markers and activity rows
    // have no action row, so they keep the list's own smaller gap.
    <View className={`gap-1 pb-2 ${align === "end" ? "items-end self-end" : "items-start self-start"}`}>
      <View
        accessibilityRole="toolbar"
        accessibilityLabel={t("mobile.chat.message.actions")}
        className="flex-row items-center"
      >
        {shown.map((reaction) =>
          reaction.actor.kind === "user" && onReact ? (
            <Button
              key="user"
              variant="ghost"
              size="sm"
              className="min-w-0 px-2"
              accessibilityLabel={t("mobile.chat.message.removeReaction", { emoji: reaction.emoji })}
              onPress={() => react(null)}
            >
              <Typography>{reaction.emoji}</Typography>
            </Button>
          ) : (
            <View
              key={reaction.actor.kind === "agent" ? `agent:${reaction.actor.agentId}` : "user"}
              accessible
              accessibilityRole="image"
              accessibilityLabel={
                reaction.actor.kind === "agent"
                  ? t("mobile.chat.message.agentReaction", {
                      name: agentsById.get(reaction.actor.agentId)?.name ?? "",
                      emoji: reaction.emoji,
                    })
                  : reaction.emoji
              }
              className="px-2"
            >
              <Typography>{reaction.emoji}</Typography>
            </View>
          ),
        )}
        {copyText ? (
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            accessibilityLabel={copied ? t("mobile.chat.message.copied") : t("mobile.chat.message.copy")}
            onPress={() => void copy()}
          >
            {copied ? <Check size={ICON_SIZE} color={muted} /> : <Copy size={ICON_SIZE} color={muted} />}
          </Button>
        ) : null}
        {onReact ? (
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            accessibilityLabel={t("mobile.chat.message.addReaction")}
            accessibilityState={{ expanded: pickerOpen }}
            onPress={() => {
              void haptics.selection();
              setPickerOpen((open) => !open);
              setMoreEmoji(false);
            }}
          >
            <SmilePlus size={ICON_SIZE} color={muted} />
          </Button>
        ) : null}
        {onReply ? (
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            accessibilityLabel={t("mobile.chat.message.reply")}
            onPress={() => {
              void haptics.selection();
              onReply();
            }}
          >
            <Reply size={ICON_SIZE} color={muted} />
          </Button>
        ) : null}
        {onSelectText ? (
          <Button
            isIconOnly
            // Drawn as pressed while the text is selected: a second tap ends the selection.
            variant={selecting ? "secondary" : "ghost"}
            size="sm"
            accessibilityLabel={t("mobile.chat.message.selectText")}
            accessibilityState={{ selected: selecting }}
            onPress={() => {
              void haptics.selection();
              onSelectText();
            }}
          >
            <TextSelect size={ICON_SIZE} color={selecting ? String(foregroundColor) : muted} />
          </Button>
        ) : null}
        {time ? (
          <Typography.Paragraph type="body-xs" className="px-1 text-muted">
            {time}
          </Typography.Paragraph>
        ) : null}
      </View>
      {pickerOpen ? (
        <Animated.View
          entering={PICKER_IN}
          exiting={PICKER_OUT}
          accessibilityLabel={t("mobile.chat.message.addReaction")}
          className="flex-row flex-wrap items-center rounded-3xl bg-control/60 px-1"
          style={{ borderCurve: "continuous" }}
        >
          {[...MESSAGE_REACTIONS, ...(moreEmoji ? MORE_MESSAGE_REACTIONS : [])].map((emoji) => (
            <Button
              key={emoji}
              isIconOnly
              variant={emoji === own ? "secondary" : "ghost"}
              accessibilityLabel={t("mobile.chat.message.react", { emoji })}
              accessibilityState={{ selected: emoji === own }}
              onPress={() => react(emoji === own ? null : emoji)}
            >
              <Typography className="text-xl">{emoji}</Typography>
            </Button>
          ))}
          {moreEmoji ? null : (
            <Button
              isIconOnly
              variant="ghost"
              accessibilityLabel={t("mobile.chat.message.moreEmoji")}
              onPress={() => {
                void haptics.selection();
                setMoreEmoji(true);
              }}
            >
              <Plus size={ICON_SIZE} color={muted} />
            </Button>
          )}
        </Animated.View>
      ) : null}
    </View>
  );
}
