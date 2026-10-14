import type { QueueDelivery } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { CornerDownRight, Pencil } from "lucide-react-native";
import { memo, useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
} from "react-native-reanimated";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import type { QueuedUpload } from "../context/queued-messages-context";
import { queueRowsWithHeldEdit } from "../model/queue-edit-draft";
import { queuedMessageLocks, queuedMessagePreview } from "../model/queued-message-view";
import { ChatQueueButton } from "./chat-queue-button";
import type { ChatQueueController } from "./use-chat-queue";

/** The number of queued messages that show above the composer. The sheet lists all of them. */
const INLINE_ROWS = 3;

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const ROW_ENTER = FadeIn.duration(200).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const ROW_EXIT = FadeOut.duration(150).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const ROW_MOVE = LinearTransition.duration(200).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

interface ChatQueuePanelProps {
  queue: ChatQueueController;
  pending?: QueuedUpload | null;
  liquidGlassAvailable: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
}

/**
 * The queue above the composer, as on desktop: the first messages with Steer and Edit on each
 * row. The pill opens the sheet with the full queue when the rows do not show all of it.
 */
export const ChatQueuePanel = memo(function ChatQueuePanel({
  queue,
  pending,
  liquidGlassAvailable,
  fallbackBackground,
}: ChatQueuePanelProps) {
  const held = queue.edit?.delivery ?? null;
  const rows = queueRowsWithHeldEdit(queue.queued, held).slice(0, INLINE_ROWS);
  // The steer that this panel started. Only its row shows the progress.
  const [steeringId, setSteeringId] = useState<string | null>(null);
  const steer = (delivery: QueueDelivery) => {
    setSteeringId(delivery.id);
    void queue.steer(delivery).then((done) => {
      setSteeringId(null);
      void haptics.notification(done ? "success" : "error");
    });
  };
  return (
    // A chat that opens with a queue shows its rows at once. Later rows fade in.
    <LayoutAnimationConfig skipEntering>
      <ChatQueueButton
        queue={queue}
        pending={pending}
        liquidGlassAvailable={liquidGlassAvailable}
        fallbackBackground={fallbackBackground}
        inline={rows.length}
      />
      {rows.length > 0 ? (
        <Animated.View entering={ROW_ENTER} exiting={ROW_EXIT} layout={ROW_MOVE} className="px-4 pb-2">
          {/* The surface of the browser requests above the composer: one opaque gray. */}
          <View className="rounded-[26px] bg-control py-1" style={{ borderCurve: "continuous" }}>
            {rows.map((delivery, index) => (
              <QueueRow
                key={delivery.id}
                delivery={delivery}
                position={delivery.position ?? index + 1}
                queue={queue}
                held={held}
                steering={steeringId === delivery.id}
                onSteer={steer}
              />
            ))}
          </View>
          {queue.error ? (
            <Typography.Paragraph
              type="body-xs"
              numberOfLines={2}
              accessibilityRole="alert"
              className="px-4 pt-1 text-danger-text"
            >
              {queue.error}
            </Typography.Paragraph>
          ) : null}
        </Animated.View>
      ) : null}
    </LayoutAnimationConfig>
  );
});

function QueueRow({
  delivery,
  position,
  queue,
  held,
  steering,
  onSteer,
}: {
  delivery: QueueDelivery;
  position: number;
  queue: ChatQueueController;
  held: QueueDelivery | null;
  steering: boolean;
  onSteer: (delivery: QueueDelivery) => void;
}) {
  const { t } = useText();
  const muted = String(useThemeColor("muted"));
  const { locked, editedElsewhere } = queuedMessageLocks(delivery, {
    busy: queue.busy,
    online: queue.online,
    held,
  });
  const editing = Boolean(delivery.editing) || held?.id === delivery.id;
  const preview = queuedMessagePreview(delivery);
  return (
    <Animated.View entering={ROW_ENTER} exiting={ROW_EXIT} layout={ROW_MOVE} className="flex-row items-center pr-1.5">
      {/* The row opens the options of the message: move to first and delete. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.chat.queue.itemLabel", { position, preview })}
        accessibilityHint={t("mobile.chat.queue.itemHint")}
        className="min-h-11 min-w-0 flex-1 flex-row items-center gap-2 py-2 pl-4"
        style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
        onPress={() => {
          void haptics.selection();
          router.push({
            pathname: "/queued-messages/actions",
            params: { chat: queue.chatId, deliveryId: delivery.id },
          });
        }}
      >
        <Typography.Paragraph type="body-sm" numberOfLines={1} className="min-w-0 shrink">
          {preview}
        </Typography.Paragraph>
        {editing ? (
          <Typography.Paragraph type="body-xs" numberOfLines={1} className="text-muted">
            {t("mobile.chat.queue.editing")}
          </Typography.Paragraph>
        ) : null}
      </Pressable>
      <Button
        size="sm"
        variant="ghost"
        className="gap-1.5 px-2.5"
        accessibilityLabel={
          steering ? t("mobile.chat.queue.steering") : t("mobile.chat.queue.steerLabel", { position })
        }
        isDisabled={steering || locked || editedElsewhere || !queue.activeTurnId}
        onPress={() => onSteer(delivery)}
      >
        {steering ? <Spinner size="sm" color={muted} /> : <CornerDownRight color={muted} size={16} strokeWidth={2} />}
        <Button.Label>{steering ? t("mobile.chat.queue.steering") : t("mobile.chat.queue.steer")}</Button.Label>
      </Button>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        accessibilityLabel={t("mobile.chat.queue.editLabel", { position })}
        isDisabled={locked || editedElsewhere || !queue.canEdit}
        onPress={() => {
          void haptics.selection();
          router.push({
            pathname: "/queued-messages/edit",
            params: { chat: queue.chatId, deliveryId: delivery.id },
          });
        }}
      >
        <Pencil color={muted} size={16} strokeWidth={2} />
      </Button>
    </Animated.View>
  );
}
