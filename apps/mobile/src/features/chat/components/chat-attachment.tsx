import { attachmentFileExtension, playableMediaKind } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import { requireOptionalNativeModule } from "expo";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Button, Skeleton, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ExternalLink from "lucide-react-native/icons/external-link";
import ImageOff from "lucide-react-native/icons/image-off";
import { useEffect, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { attachmentFrame, FILL, FRAME_RADIUS, MAX_FRAME_WIDTH } from "../model/attachment-frame";
import { storeCodePreview } from "../model/code-preview-store";
import { type ImageDimensions, sameShape } from "../model/image-dimensions";
import { attachmentTypeLabel, rememberImageDimensions, useAttachmentFile } from "./attachment-preview";
import { isViewableImage, useChatImageSource } from "./chat-image-viewer";
import { UPLOAD_BLUR_RADIUS, UPLOAD_SETTLE_MS, UploadProgressCircle, useUploadRevealStyle } from "./upload-progress";
import { useMediaFile } from "./use-media-file";

// The width reserved while the shape is still unknown: a portrait phone photo.
const UNKNOWN_RATIO = 3 / 4;

/**
 * The video player, loaded only when this app build has its native module. An older development
 * build has none, and `expo-video` requires the module when it loads, so a video there stays a file.
 */
const chatVideo: typeof import("./chat-video.native") | null = requireOptionalNativeModule("ExpoVideo")
  ? require("./chat-video.native")
  : null;
/** The audio player uses the same native module, so an older build shows audio as a file too. */
const chatAudio: typeof import("./chat-audio.native") | null = chatVideo ? require("./chat-audio.native") : null;

/** A Markdown file, which opens in the preview screen instead of the share sheet. */
function isMarkdownFile(attachment: AttachmentSummary) {
  const extension = attachmentFileExtension(attachment.name);
  return attachment.mimeType === "text/markdown" || extension === "md" || extension === "markdown";
}

interface ChatAttachmentProps {
  attachment: AttachmentSummary;
  serverId: string;
  alignment?: "left" | "right";
  /** The sent fraction of this file, from 0 to 1, while the message that carries it is sending. */
  upload?: number;
  /** The agent's color for the controls of a player, unless the user turned off agent colors. */
  tint?: AttachmentTint;
}

export interface AttachmentTint {
  color: string;
  /** Text and icons on the color. */
  foreground: string;
}

export function ChatAttachmentView(props: ChatAttachmentProps) {
  const { attachment } = props;
  // Media plays once it is on the host. While it uploads, the file card shows the progress.
  const playable =
    props.upload === undefined &&
    attachment.size <= MOBILE_ATTACHMENT_BYTES &&
    !attachment.id.startsWith("mobile-draft-attachment-");
  const media = playable ? playableMediaKind(attachment.mimeType) : null;
  if (chatVideo && media === "video") return <chatVideo.ChatVideoAttachment {...props} />;
  if (chatAudio && media === "audio") return <chatAudio.ChatAudioAttachment {...props} />;
  return <ChatFileAttachment {...props} />;
}

function ChatFileAttachment({ attachment, serverId, alignment = "left", upload }: ChatAttachmentProps) {
  const { t, format, sourceText } = useText();
  const [fileColor, muted] = useThemeColor(["success", "muted"]);
  const [decoded, setDecoded] = useState<ImageDimensions | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  // The send can finish before the upload view has settled. Hold it as complete for that long,
  // so the photo finishes coming into focus instead of jumping to sharp in one frame.
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (upload !== undefined) {
      setLingering(true);
      return;
    }
    const timer = setTimeout(() => setLingering(false), UPLOAD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [upload]);
  const shownUpload = upload ?? (lingering ? 1 : undefined);
  const revealStyle = useUploadRevealStyle(shownUpload ?? 1);
  const { width } = useWindowDimensions();
  const tooLarge = attachment.size > MOBILE_ATTACHMENT_BYTES;
  // An image above the transfer limit cannot be shown here, so it is a file the user opens on desktop.
  const image = attachment.kind === "image" && !tooLarge;
  const { pending, localUri, uri, dimensions, query, sharing, share } = useAttachmentFile(serverId, attachment, image);
  // The conversation's viewer measures this copy and hides it on the UI thread while it holds the picture.
  const source = useChatImageSource(image && isViewableImage(attachment) ? attachment.id : null, FRAME_RADIUS);
  const maxWidth = Math.min(MAX_FRAME_WIDTH, width - 80);
  const shape = decoded ?? dimensions;
  const frame = attachmentFrame(shape, maxWidth, UNKNOWN_RATIO);
  const failed = Boolean(query.error) || imageFailed;
  const markdown = !tooLarge && isMarkdownFile(attachment);
  // A Markdown file downloads when the user opens it, to the same place a player reads from.
  const markdownFile = useMediaFile(serverId, attachment, false);
  const [opening, setOpening] = useState(false);
  const busy = sharing || query.isFetching || opening;

  async function openMarkdown() {
    setOpening(true);
    try {
      const result = markdownFile.data ? { data: markdownFile.data, error: null } : await markdownFile.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error(t("mobile.chat.attachment.unavailable"));
      const source = await new File(result.data).text();
      const previewId = storeCodePreview({
        kind: "markdown",
        source,
        language: "markdown",
        file: { uri: result.data, name: attachment.name, mimeType: attachment.mimeType },
      });
      router.push({ pathname: "/code-preview/[previewId]", params: { previewId } });
    } catch (error) {
      void haptics.notification("error");
      showFailureAlert(
        error,
        "turn",
        t("mobile.chat.attachment.openFailed"),
        error instanceof Error ? sourceText(error.message) : t("mobile.chat.tryAgain"),
      );
    } finally {
      setOpening(false);
    }
  }

  if (image)
    return (
      <View className={`max-w-full gap-2 ${alignment === "right" ? "items-end" : "items-start"}`}>
        <View
          style={{
            width: frame.width,
            height: frame.height,
            maxWidth: "100%",
            borderRadius: FRAME_RADIUS,
            borderCurve: "continuous",
            overflow: "hidden",
          }}
        >
          <Animated.View ref={source.origin} collapsable={false} style={[FILL, source.hiddenStyle]}>
            {/* A plain pressable: a HeroUI button keeps its own side padding and row gap, which
                pushed the image off the frame's right edge. Every layer here fills the frame. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.chat.attachment.preview", { name: attachment.name })}
              accessibilityState={{ disabled: pending || !uri || failed }}
              disabled={pending || !uri || failed}
              onPress={() => source.open?.(attachment)}
              style={FILL}
            >
              {failed ? (
                <View className="items-center justify-center gap-2 p-3" style={FILL}>
                  <ImageOff size={24} color={String(muted)} />
                  <Typography.Paragraph type="body-xs" align="center" className="text-muted">
                    {query.error ? sourceText(query.error.message) : t("mobile.chat.attachment.displayFailed")}
                  </Typography.Paragraph>
                </View>
              ) : (
                <>
                  {/* Under the image, so a cached image covers it at once; it leaves when the image
                    loads, so nothing shows through a transparent picture afterwards. */}
                  <Skeleton
                    isLoading={!imageLoaded}
                    accessible
                    accessibilityLabel={t("mobile.chat.attachment.loadingImage")}
                    className="rounded-none"
                    style={FILL}
                  />
                  {shownUpload !== undefined && uri ? (
                    // A blurred copy under the sharp photo while it uploads. Whole, like the photo,
                    // so the picture never looks cut while it comes into focus.
                    <Image
                      source={uri}
                      blurRadius={UPLOAD_BLUR_RADIUS}
                      transition={0}
                      contentFit="contain"
                      accessible={false}
                      style={FILL}
                    />
                  ) : null}
                  <Animated.View style={[FILL, revealStyle]}>
                    <Image
                      source={uri}
                      transition={localUri ? 0 : 220}
                      // The frame has the image's shape, so this fills it; only an extremely
                      // narrow image leaves a margin at its sides instead of losing its ends.
                      contentFit="contain"
                      accessibilityLabel={attachment.name}
                      style={FILL}
                      onLoad={({ source }) => {
                        setImageLoaded(true);
                        if (source.width <= 0 || source.height <= 0) return;
                        // The decoder has the final word on the shape. The header is read first,
                        // to reserve the frame early, but a rotation tag can make it disagree.
                        const size = { width: source.width, height: source.height };
                        if (dimensions && sameShape(dimensions, size)) return;
                        rememberImageDimensions(attachment.id, size);
                        setDecoded(size);
                      }}
                      onError={() => setImageFailed(true)}
                    />
                  </Animated.View>
                </>
              )}
            </Pressable>
          </Animated.View>
          {upload !== undefined ? (
            // The focus says it visually; this says it to a screen reader.
            <View
              pointerEvents="none"
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t("mobile.chat.attachment.uploading", { name: attachment.name })}
              accessibilityValue={{ min: 0, max: 100, now: Math.round(upload * 100) }}
              style={FILL}
            />
          ) : null}
        </View>
        {failed ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => {
              setImageFailed(false);
              void query.refetch();
            }}
          >
            <Button.Label>{t("mobile.chat.attachment.retryImage")}</Button.Label>
          </Button>
        ) : null}
      </View>
    );

  const typeLabel = attachmentTypeLabel(attachment.name, attachment.mimeType, t);
  const detail = tooLarge
    ? t("mobile.chat.attachment.openOnDesktopDetail", { size: format.fileSize(attachment.size) })
    : upload !== undefined
      ? t("mobile.chat.attachment.uploadingPercent", { percent: format.percent(upload) })
      : busy
        ? t("mobile.chat.attachment.downloading")
        : `${typeLabel} · ${format.fileSize(attachment.size)}`;
  return (
    <View className={`max-w-full ${alignment === "right" ? "items-end" : "items-start"}`}>
      <Button
        variant="secondary"
        className="h-auto flex-row justify-start gap-3 rounded-2xl border border-border bg-control p-3"
        style={{ width: maxWidth, maxWidth: "100%" }}
        isDisabled={pending || busy || tooLarge}
        accessibilityLabel={
          markdown
            ? t("mobile.chat.attachment.preview", { name: attachment.name })
            : t("mobile.chat.attachment.openOrSave", { name: attachment.name })
        }
        accessibilityHint={tooLarge ? t("mobile.chat.attachment.tooLargeHint") : undefined}
        // The card is one element to a screen reader, so the progress inside it is read from here.
        accessibilityValue={upload !== undefined ? { min: 0, max: 100, now: Math.round(upload * 100) } : undefined}
        onPress={() => {
          void haptics.impact("soft");
          if (markdown) void openMarkdown();
          else share();
        }}
      >
        <View className="size-11 items-center justify-center rounded-xl bg-success/15">
          <Typography.Paragraph type="body-xs" className="font-semibold" style={{ color: fileColor }}>
            {typeLabel}
          </Typography.Paragraph>
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Typography.Paragraph type="body-sm" numberOfLines={2} className="font-semibold text-foreground">
            {attachment.name}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" className="text-muted">
            {detail}
          </Typography.Paragraph>
        </View>
        {/* Where the share icon will be: the file's progress, then a check, then the icon. */}
        {shownUpload !== undefined ? (
          <UploadProgressCircle progress={shownUpload} />
        ) : markdown ? (
          <ChevronRight size={18} color={muted} />
        ) : (
          <ExternalLink size={18} color={muted} />
        )}
      </Button>
    </View>
  );
}
