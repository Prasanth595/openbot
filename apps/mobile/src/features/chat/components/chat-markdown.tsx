import {
  type FileReferenceTone,
  fileReferenceBadge,
  fileReferenceName,
  fileReferenceTone,
  isFileReference,
} from "@openbot/brand/file-reference";
import { chatMathStart } from "@openbot/contracts/chat-math";
import { chatPreviewKind } from "@openbot/contracts/chat-preview";
import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import * as Linking from "expo-linking";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { FileText } from "lucide-react-native";
import type { Token, Tokens } from "marked";
import { Fragment, memo, type ReactNode, useEffect, useId, useMemo, useRef } from "react";
import { type ColorValue, ScrollView, type TextStyle, useWindowDimensions, View } from "react-native";
import { UITextView } from "react-native-uitextview";
import { useCSSVariable } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { ChatLinkIcon } from "@/features/chat/components/chat-link-icon";
import {
  StreamingBlock,
  StreamingTailText,
  StreamRevealProvider,
} from "@/features/chat/components/streaming-tail-text";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { graphemes } from "@/shared/lib/graphemes";
import { haptics } from "@/shared/lib/haptics";
import { useMotionPreference } from "@/shared/lib/motion";
import { currentText, useText } from "@/shared/lib/text";
import { parseChatMarkdown } from "../model/chat-markdown-parser";
import { plainMentionParts } from "../model/chat-mentions";
import { createReplyReveal } from "../model/reply-reveal";
import { ChatCodeBlock } from "./chat-code-block";
import { ChatCodePreview } from "./chat-code-preview";
import { ChatMath } from "./chat-math";
import { type ReplyPlayback, useReplyPlayback } from "./use-reply-playback";

interface MarkdownTokenByType {
  paragraph: Tokens.Paragraph;
  heading: Tokens.Heading;
  blockquote: Tokens.Blockquote;
  list: Tokens.List;
  code: Tokens.Code;
  table: Tokens.Table;
  text: Tokens.Text;
  escape: Tokens.Escape;
  strong: Tokens.Strong;
  em: Tokens.Em;
  del: Tokens.Del;
  codespan: Tokens.Codespan;
  link: Tokens.Link;
  image: Tokens.Image;
  blockMath: MathToken;
  inlineMath: MathToken;
}

interface MathToken extends Tokens.Generic {
  type: "blockMath" | "inlineMath";
  text: string;
  display: boolean;
}

// Marked's public Token union includes extension tokens; narrow its built-in tokens here.
// Keeps the link icon on the same line as the first word of the link.
const NO_BREAK_SPACE = "\u00a0";
/** A selection that the handles still change reaches the chat after this pause. */
const SELECTION_REPORT_DELAY_MS = 80;

function tokenIs<K extends keyof MarkdownTokenByType>(token: Token, type: K): token is MarkdownTokenByType[K] {
  return token.type === type;
}

/**
 * Where a native selectable paragraph reports the text the reader selected in it. Unset where the
 * text is not a native text view: while a reply streams or reveals, in Expo Go and on Android.
 */
interface NativeSelectionTarget {
  /** Changes when the selection ends outside the paragraph, which then draws again without it. */
  generation: number;
  report: (paragraph: string, selected: string) => void;
}

interface TextPresentation {
  selectable: boolean;
  nativeSelection?: NativeSelectionTarget;
  type: "body" | "body-sm" | "h4" | "h5";
  style: TextStyle;
  codeColor: ColorValue;
  animateTail: boolean;
  /** The reply still streams, so a preview card shows code until its block is complete. */
  streaming: boolean;
  agents: readonly MobileAgent[];
  mentionOffset: number;
  fontScale: number;
  t: MobileTranslate;
}

/** The HeroUI font size of each text type, in points, which inline math is sized against. */
const TEXT_SIZES: Record<TextPresentation["type"], number> = { body: 16, "body-sm": 14, h4: 20, h5: 18 };

function textSize(presentation: TextPresentation): number {
  return TEXT_SIZES[presentation.type] * presentation.fontScale;
}

// The inline badge is shifted to align its label with native text. Reserve the
// same space in the owning text view so its last line does not clip the capsule.
function textContainerStyle(source: string, presentation: TextPresentation): TextStyle {
  const hasMention =
    chatTagReferences(source).some((reference) => reference.kind === "agent") ||
    plainMentionParts(source, presentation.agents).some((part) => part.agent);
  // Inline math is moved down to the math axis in the same way.
  const hasMath = chatMathStart(source) !== undefined;
  return hasMention || hasMath
    ? { ...presentation.style, paddingBottom: presentation.mentionOffset, overflow: "visible" }
    : presentation.style;
}

function webLink(href: string): string | null {
  try {
    const url = new URL(href);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// Source positions remain stable as the last token grows during streaming.
function sourceEntries<T>(values: T[], source: (value: T) => string) {
  let offset = 0;
  return values.map((value) => {
    const entry = { value, offset };
    offset += source(value).length + 1;
    return entry;
  });
}

/** The colour family of each file tone, as the desktop `data-file-tone` rules use them. */
const FILE_TONE_COLORS: Record<FileReferenceTone, [string, string]> = {
  source: ["--openbot-file-blue", "--openbot-file-blue-soft"],
  script: ["--openbot-file-yellow", "--openbot-file-yellow-soft"],
  markup: ["--openbot-file-orange", "--openbot-file-orange-soft"],
  style: ["--openbot-file-teal", "--openbot-file-teal-soft"],
  data: ["--openbot-file-green", "--openbot-file-green-soft"],
  document: ["--openbot-file-red", "--openbot-file-red-soft"],
  media: ["--openbot-file-pink", "--openbot-file-pink-soft"],
  default: ["--openbot-file-default", "--openbot-file-default-soft"],
};

/**
 * Inline code that names a file, drawn as the desktop file reference: a type badge and the name
 * in the colour of its file family. Mobile cannot open workspace files, so it is not a control.
 */
function FileReference({ text, presentation }: { text: string; presentation: TextPresentation }) {
  const name = fileReferenceName(text.trim());
  const badge = fileReferenceBadge(name);
  const [color, soft] = useCSSVariable(FILE_TONE_COLORS[fileReferenceTone(name)]);
  const small = presentation.type === "body-sm";
  return (
    <View collapsable={false} className="max-w-full shrink flex-row items-center gap-1 self-start px-0.5">
      <View
        className="h-4 min-w-4 items-center justify-center rounded px-0.5"
        style={{ backgroundColor: String(soft) }}
      >
        {badge ? (
          <Typography style={{ color: String(color), fontSize: 8, lineHeight: 10, fontWeight: "800" }}>
            {badge}
          </Typography>
        ) : (
          <FileText size={11} color={String(color)} strokeWidth={2} />
        )}
      </View>
      <Typography
        selectable={presentation.selectable}
        numberOfLines={1}
        type={small ? "body-xs" : presentation.type}
        className="shrink"
        style={{ ...presentation.style, color: String(color), fontWeight: "600" }}
      >
        {text.trim()}
      </Typography>
    </View>
  );
}

// A view cannot break across lines, so code is a row of one-line chips that touch. A line can break
// after a space or a separator, and a long run without one breaks after this many characters.
const CODE_PIECE_MAX_LENGTH = 12;

function codePieces(text: string): string[] {
  return (text.match(/[^\s\-/._]*(?:[\s\-/._]+|$)/gu) ?? []).flatMap((piece) => {
    const characters = graphemes(piece);
    if (!characters.length) return [];
    const chunks: string[] = [];
    for (let index = 0; index < characters.length; index += CODE_PIECE_MAX_LENGTH) {
      chunks.push(characters.slice(index, index + CODE_PIECE_MAX_LENGTH).join(""));
    }
    return chunks;
  });
}

function CodeSpan({ text, presentation }: { text: string; presentation: TextPresentation }) {
  if (isFileReference(text.trim())) return <FileReference text={text} presentation={presentation} />;
  const pieces = codePieces(text);
  return sourceEntries(pieces, (piece) => piece).map(({ value: piece, offset }, index) => (
    // Only the ends of the span are rounded, so touching pieces read as one chip.
    <View
      key={offset}
      collapsable={false}
      className={`max-w-full self-start bg-control ${index === 0 ? "rounded-l-xl pl-1" : ""} ${index === pieces.length - 1 ? "rounded-r-xl pr-1" : ""} ${presentation.type === "body-sm" ? "py-px" : "py-0.5"}`}
    >
      <Typography.Code
        selectable={presentation.selectable}
        numberOfLines={1}
        className={presentation.type === "body-sm" ? "bg-transparent p-0 text-xs leading-4" : "bg-transparent p-0"}
        style={{ ...presentation.style, color: presentation.codeColor }}
      >
        {piece}
      </Typography.Code>
    </View>
  ));
}

function AgentMention({ agent, presentation }: { agent: MobileAgent; presentation: TextPresentation }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View
      collapsable={false}
      className="max-w-full flex-row items-center gap-1 rounded-full bg-control/30 px-1.5"
      // Native inline views sit on the text baseline. Offset the text descender
      // so the name aligns with the surrounding text instead of sitting above it.
      style={{ transform: [{ translateY: presentation.mentionOffset }], borderCurve: "circular" }}
    >
      <BloubAvatarThumbnail
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        seed={agent.avatarSeed}
        size={(presentation.type === "body-sm" ? 16 : 18) * fontScale}
      />
      <Typography type={presentation.type} style={presentation.style} className="shrink">
        {agent.name}
      </Typography>
    </View>
  );
}

function openMessageLink(url: string): void {
  void haptics.impact("soft");
  void Linking.openURL(url).catch((error: unknown) => {
    void haptics.notification("error");
    const { t } = currentText();
    showFailureAlert(
      error,
      "browser",
      t("mobile.chat.markdown.linkFailedTitle"),
      t("mobile.chat.markdown.linkFailedMessage"),
    );
  });
}

function inline(tokens: Token[], parentPresentation: TextPresentation): ReactNode {
  return sourceEntries(tokens, (token) => token.raw).map(({ value: token, offset }) => {
    const presentation = { ...parentPresentation, animateTail: parentPresentation.animateTail };
    if (token.type === "agentMention") {
      const reference = chatTagReferences(token.raw)[0];
      const agent = presentation.agents.find((candidate) => candidate.id === reference?.id);
      if (!agent)
        return (
          <Typography
            key={offset}
            type={presentation.type}
            style={presentation.style}
          >{`@${reference?.name ?? "Agent"}`}</Typography>
        );
      return <AgentMention key={offset} agent={agent} presentation={presentation} />;
    }
    if (token.type === "br") return "\n";
    // The list row draws the task mark, so the checkbox token adds nothing.
    if (token.type === "checkbox") return null;
    if (tokenIs(token, "inlineMath")) {
      return (
        <ChatMath
          key={offset}
          tex={token.text}
          display={token.display}
          block={false}
          textSize={textSize(presentation)}
          color={presentation.style.color}
          fallback={<CodeSpan text={token.raw} presentation={presentation} />}
        />
      );
    }
    if (tokenIs(token, "text")) {
      if (token.tokens) return inline(token.tokens, presentation);
      return (
        <Fragment key={offset}>
          {sourceEntries(plainMentionParts(token.text, presentation.agents), (part) => part.text).map(
            ({ value: part, offset: partOffset }) =>
              part.agent ? (
                <AgentMention key={partOffset} agent={part.agent} presentation={presentation} />
              ) : (
                <StreamingTailText
                  key={partOffset}
                  body={part.text}
                  enabled={presentation.animateTail}
                  type={presentation.type}
                  style={presentation.style}
                />
              ),
          )}
        </Fragment>
      );
    }
    if (tokenIs(token, "escape")) return token.text;
    if (tokenIs(token, "codespan")) {
      return <CodeSpan key={offset} text={token.text} presentation={presentation} />;
    }
    if (tokenIs(token, "strong") || tokenIs(token, "em") || tokenIs(token, "del")) {
      const style: TextStyle = {
        ...presentation.style,
        ...(token.type === "strong"
          ? { fontWeight: "700" }
          : token.type === "em"
            ? { fontStyle: "italic" }
            : { textDecorationLine: "line-through" }),
      };
      return (
        <Typography key={offset} type={presentation.type} style={style}>
          {inline(token.tokens, { ...presentation, style })}
        </Typography>
      );
    }
    if (tokenIs(token, "link") || tokenIs(token, "image")) {
      const url = webLink(token.href);
      const label = tokenIs(token, "image")
        ? token.text || presentation.t("mobile.chat.markdown.image")
        : inline(token.tokens, { ...presentation, agents: [] });
      if (!url) return <Fragment key={offset}>{label}</Fragment>;
      return (
        <Typography
          key={offset}
          type={presentation.type}
          style={{ ...presentation.style, textDecorationLine: "underline" }}
          accessibilityRole="link"
          accessibilityHint={url}
          onPress={() => openMessageLink(url)}
        >
          {tokenIs(token, "link") ? (
            <>
              <ChatLinkIcon color={presentation.style.color} compact={presentation.type === "body-sm"} />
              {NO_BREAK_SPACE}
            </>
          ) : null}
          {label}
        </Typography>
      );
    }
    // HTML remains inert text; Markdown images are opened only after an explicit tap.
    return token.raw;
  });
}

/** The HeroUI text types as plain styles: a native text view takes no class names. */
const NATIVE_TEXT_STYLES: Record<TextPresentation["type"], TextStyle> = {
  body: { fontSize: 16, lineHeight: 28 },
  "body-sm": { fontSize: 14, lineHeight: 24 },
  h4: { fontSize: 20, lineHeight: 28, letterSpacing: -0.5 },
  h5: { fontSize: 18, lineHeight: 28, letterSpacing: -0.45 },
};

/**
 * A part of a native paragraph, in the order the text view draws it. An inline view, such as a
 * mention or a code chip, takes one character in the text view and gives its own text to a quote.
 */
interface SelectableSegment {
  length: number;
  text: string;
}

function selectedSegmentsText(segments: readonly SelectableSegment[], start: number, end: number): string {
  let offset = 0;
  let selected = "";
  for (const segment of segments) {
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + segment.length);
    if (from < to) {
      selected +=
        segment.length === segment.text.length ? segment.text.slice(from - offset, to - offset) : segment.text;
    }
    offset += segment.length;
  }
  return selected;
}

/**
 * The inline tokens as children of a native text view, with the same look as `inline`. Strings and
 * nested `UITextView`s are text; any other view is an inline view. The text view cannot hold a
 * fragment, so this returns a flat list, and it records each part in `segments` in drawing order.
 */
function selectableInline(tokens: Token[], presentation: TextPresentation, segments: SelectableSegment[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  const text = (value: string) => {
    if (!value) return;
    segments.push({ length: value.length, text: value });
    nodes.push(value);
  };
  const inlineView = (node: ReactNode, quote: string) => {
    segments.push({ length: 1, text: quote });
    nodes.push(node);
  };
  for (const { value: token, offset } of sourceEntries(tokens, (entry) => entry.raw)) {
    if (token.type === "agentMention") {
      const reference = chatTagReferences(token.raw)[0];
      const agent = presentation.agents.find((candidate) => candidate.id === reference?.id);
      if (agent) inlineView(<AgentMention key={offset} agent={agent} presentation={presentation} />, `@${agent.name}`);
      else text(`@${reference?.name ?? "Agent"}`);
    } else if (token.type === "br") {
      text("\n");
    } else if (token.type === "checkbox") {
      // The list row draws the task mark.
    } else if (tokenIs(token, "inlineMath")) {
      // One view, so the formula is one character whether it draws or falls back to code.
      inlineView(
        <View key={offset} collapsable={false} className="flex-row flex-wrap">
          <ChatMath
            tex={token.text}
            display={token.display}
            block={false}
            textSize={textSize(presentation)}
            color={presentation.style.color}
            fallback={<CodeSpan text={token.raw} presentation={presentation} />}
          />
        </View>,
        token.raw,
      );
    } else if (tokenIs(token, "text")) {
      if (token.tokens) {
        nodes.push(...selectableInline(token.tokens, presentation, segments));
      } else {
        for (const part of plainMentionParts(token.text, presentation.agents)) {
          if (part.agent) {
            inlineView(
              <AgentMention key={`${offset}:${segments.length}`} agent={part.agent} presentation={presentation} />,
              `@${part.agent.name}`,
            );
          } else {
            text(part.text);
          }
        }
      }
    } else if (tokenIs(token, "escape")) {
      text(token.text);
    } else if (tokenIs(token, "codespan")) {
      // `CodeSpan` draws one chip per piece, and each chip is one inline view.
      const pieces = isFileReference(token.text.trim()) ? [token.text.trim()] : codePieces(token.text);
      for (const piece of pieces) segments.push({ length: 1, text: piece });
      nodes.push(<CodeSpan key={offset} text={token.text} presentation={presentation} />);
    } else if (tokenIs(token, "strong") || tokenIs(token, "em") || tokenIs(token, "del")) {
      const style: TextStyle = {
        ...presentation.style,
        ...(token.type === "strong"
          ? { fontWeight: "700" }
          : token.type === "em"
            ? { fontStyle: "italic" }
            : { textDecorationLine: "line-through" }),
      };
      nodes.push(
        <UITextView key={offset} style={style}>
          {selectableInline(token.tokens, { ...presentation, style }, segments)}
        </UITextView>,
      );
    } else if (tokenIs(token, "link") || tokenIs(token, "image")) {
      const url = webLink(token.href);
      const label: ReactNode[] = [];
      if (url && tokenIs(token, "link")) {
        segments.push({ length: 1, text: "" }, { length: 1, text: NO_BREAK_SPACE });
        label.push(
          <ChatLinkIcon key="icon" color={presentation.style.color} compact={presentation.type === "body-sm"} />,
          NO_BREAK_SPACE,
        );
      }
      if (tokenIs(token, "image")) {
        const name = token.text || presentation.t("mobile.chat.markdown.image");
        segments.push({ length: name.length, text: name });
        label.push(name);
      } else {
        label.push(...selectableInline(token.tokens, { ...presentation, agents: [] }, segments));
      }
      if (!url) {
        nodes.push(...label);
      } else {
        nodes.push(
          <UITextView
            key={offset}
            style={{ ...presentation.style, textDecorationLine: "underline" }}
            onPress={() => openMessageLink(url)}
          >
            {label}
          </UITextView>,
        );
      }
    } else {
      // HTML remains inert text.
      text(token.raw);
    }
  }
  return nodes;
}

/**
 * A paragraph or a heading as a native iOS text view: a touch and hold selects the word under the
 * finger, the handles change the range, and the formatting stays as it is drawn.
 */
function SelectableParagraph({
  tokens,
  presentation,
  style,
  heading = false,
}: {
  tokens: Token[];
  presentation: TextPresentation & { nativeSelection: NativeSelectionTarget };
  style: TextStyle;
  heading?: boolean;
}) {
  const paragraph = useId();
  const segments: SelectableSegment[] = [];
  const children = selectableInline(tokens, presentation, segments);
  const report = presentation.nativeSelection.report;
  return (
    <UITextView
      // A new generation draws the paragraph again, which ends a selection that is still in it.
      key={presentation.nativeSelection.generation}
      uiTextView
      selectable
      accessibilityRole={heading ? "header" : undefined}
      style={[NATIVE_TEXT_STYLES[presentation.type], style]}
      onSelectionChange={({ nativeEvent }) =>
        report(
          paragraph,
          nativeEvent.start === nativeEvent.end
            ? ""
            : selectedSegmentsText(segments, nativeEvent.start, nativeEvent.end),
        )
      }
    >
      {children}
    </UITextView>
  );
}

function ListParagraph({ tokens, presentation }: { tokens: Token[]; presentation: TextPresentation }) {
  let run: Token[] = [];
  let line: Token[][] = [run];
  const lines: Token[][][] = [line];
  for (const token of tokens) {
    if (token.type === "checkbox") continue;
    if (token.type === "br") {
      run = [];
      line = [run];
      lines.push(line);
    } else if (tokenIs(token, "codespan")) {
      run = [];
      line.push([token], run);
    } else if (tokenIs(token, "text") && !token.tokens) {
      // One run per word: the row wraps its items, so a long run would leave the line beside the
      // chip and start below it, instead of continuing after it as text does.
      for (const word of token.text.split(/(?<=\s)/u)) {
        if (run.length) {
          run = [];
          line.push(run);
        }
        run.push({ type: "text", raw: word, text: word, escaped: false });
      }
      run = [];
      line.push(run);
    } else {
      run.push(token);
    }
  }
  const source = (run: Token[]) => run.map((token) => token.raw).join("");
  return (
    <View className="min-w-0 gap-1">
      {sourceEntries(lines, (line) => line.map(source).join("")).map(({ value: line, offset: lineOffset }) => (
        // Multiline chips must participate in flex layout, not sit inside a fixed-height native text line.
        <View key={lineOffset} className="min-w-0 flex-row flex-wrap items-center gap-y-1">
          {sourceEntries(line, source).map(({ value: run, offset }) => {
            const [token] = run;
            if (!token) return null;
            if (tokenIs(token, "codespan")) {
              return <CodeSpan key={offset} text={token.text} presentation={presentation} />;
            }
            return (
              <Typography
                key={offset}
                selectable={presentation.selectable}
                className="max-w-full"
                type={presentation.type}
                style={textContainerStyle(source(run), presentation)}
              >
                {inline(run, {
                  ...presentation,
                  animateTail: presentation.animateTail,
                })}
              </Typography>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function MarkdownBlocks({
  tokens,
  presentation: parentPresentation,
  inList = false,
}: {
  tokens: Token[];
  presentation: TextPresentation;
  inList?: boolean;
}) {
  return (
    <View className="min-w-0 gap-3">
      {sourceEntries(tokens, (token) => token.raw).map(({ value: token, offset }) => {
        const presentation = {
          ...parentPresentation,
          animateTail: parentPresentation.animateTail,
        };
        // The list row draws the task mark, so the checkbox token adds nothing.
        if (token.type === "space" || token.type === "def" || token.type === "checkbox") return null;
        if (tokenIs(token, "paragraph") || tokenIs(token, "text")) {
          if (inList && token.tokens?.some((child) => tokenIs(child, "codespan"))) {
            return <ListParagraph key={offset} tokens={token.tokens} presentation={presentation} />;
          }
          const { nativeSelection } = presentation;
          if (nativeSelection) {
            return (
              <SelectableParagraph
                key={offset}
                tokens={token.tokens ?? [{ type: "text", raw: token.text, text: token.text, escaped: false }]}
                presentation={{ ...presentation, nativeSelection }}
                style={textContainerStyle(token.raw, presentation)}
              />
            );
          }
          return (
            <Typography
              key={offset}
              selectable={presentation.selectable}
              type={presentation.type}
              style={textContainerStyle(token.raw, presentation)}
            >
              {token.tokens ? inline(token.tokens, presentation) : token.text}
            </Typography>
          );
        }
        if (tokenIs(token, "heading")) {
          const heading: TextPresentation = { ...presentation, type: token.depth <= 2 ? "h4" : "h5" };
          const { nativeSelection } = heading;
          if (nativeSelection) {
            return (
              <SelectableParagraph
                key={offset}
                heading
                tokens={token.tokens}
                presentation={{ ...heading, nativeSelection }}
                style={textContainerStyle(token.raw, presentation)}
              />
            );
          }
          return (
            <Typography.Heading
              key={offset}
              selectable={presentation.selectable}
              type={heading.type === "h4" ? "h4" : "h5"}
              style={textContainerStyle(token.raw, presentation)}
            >
              {inline(token.tokens, heading)}
            </Typography.Heading>
          );
        }
        if (tokenIs(token, "blockMath") || (tokenIs(token, "code") && token.lang?.trim().toLowerCase() === "math")) {
          return (
            <StreamingBlock key={offset} enabled={presentation.animateTail}>
              <ChatMath
                tex={token.text}
                display
                block
                textSize={textSize(presentation)}
                color={presentation.style.color}
                fallback={<ChatCodeBlock selectable={presentation.selectable} text={token.text} language="latex" />}
              />
            </StreamingBlock>
          );
        }
        if (tokenIs(token, "code")) {
          const preview = chatPreviewKind(token.lang);
          return (
            <StreamingBlock key={offset} enabled={presentation.animateTail}>
              {preview ? (
                <ChatCodePreview
                  kind={preview}
                  text={token.text}
                  language={token.lang}
                  streaming={presentation.streaming}
                />
              ) : (
                <ChatCodeBlock selectable={presentation.selectable} text={token.text} language={token.lang} />
              )}
            </StreamingBlock>
          );
        }
        if (tokenIs(token, "blockquote")) {
          return (
            <View key={offset} className="border-l-2 border-separator pl-3">
              <MarkdownBlocks tokens={token.tokens} presentation={presentation} inList={inList} />
            </View>
          );
        }
        if (tokenIs(token, "list")) {
          return (
            <View key={offset} className="gap-2">
              {sourceEntries(token.items, (item) => item.raw).map(({ value: item, offset: itemOffset }, itemIndex) => (
                <View key={itemOffset} className="flex-row items-start gap-2">
                  <Typography type={presentation.type} style={presentation.style}>
                    {item.task
                      ? item.checked
                        ? "☑"
                        : "☐"
                      : token.ordered
                        ? `${Number(token.start) + itemIndex}.`
                        : "•"}
                  </Typography>
                  <View className="min-w-0 shrink">
                    <MarkdownBlocks
                      tokens={item.tokens}
                      inList
                      presentation={{
                        ...presentation,
                        animateTail: presentation.animateTail,
                      }}
                    />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        if (tokenIs(token, "table")) {
          return (
            <ScrollView key={offset} horizontal alwaysBounceHorizontal={false} style={{ flexGrow: 0, flexShrink: 0 }}>
              <View>
                {sourceEntries([token.header, ...token.rows], (row) => row.map((cell) => cell.text).join("|")).map(
                  ({ value: row, offset: rowOffset }) => (
                    <View key={rowOffset} className="flex-row border-b border-separator">
                      {sourceEntries(row, (cell) => cell.text).map(({ value: cell, offset: cellOffset }) => (
                        <View key={cellOffset} className="w-44 px-2 py-2">
                          <Typography
                            selectable={presentation.selectable}
                            type={presentation.type}
                            style={{
                              ...textContainerStyle(cell.text, presentation),
                              textAlign: cell.align ?? "left",
                              fontWeight: cell.header ? "600" : "400",
                            }}
                          >
                            {inline(cell.tokens, {
                              ...presentation,
                              animateTail: presentation.animateTail,
                            })}
                          </Typography>
                        </View>
                      ))}
                    </View>
                  ),
                )}
              </View>
            </ScrollView>
          );
        }
        if (token.type === "hr") return <View key={offset} className="h-px bg-separator" />;
        return (
          <Typography
            key={offset}
            selectable={presentation.selectable}
            type={presentation.type}
            style={presentation.style}
          >
            {token.raw}
          </Typography>
        );
      })}
    </View>
  );
}

export const ChatMarkdown = memo(function ChatMarkdown({
  body,
  color,
  compact = false,
  streaming = false,
  animationEnabled = true,
  playback,
  selectable = true,
  agents = [],
  nativeSelection,
}: {
  body: string;
  color: ColorValue | undefined;
  compact?: boolean;
  streaming?: boolean;
  animationEnabled?: boolean;
  playback?: ReplyPlayback;
  selectable?: boolean;
  agents?: readonly MobileAgent[];
  /**
   * Draws the text as native selectable text views, and reports the text selected in the message,
   * or an empty string when the selection ends. A new `generation` ends a selection from outside.
   */
  nativeSelection?: { generation: number; onSelect: (selected: string) => void };
}) {
  const textReveal = useMotionPreference("textReveal");
  const { fontScale } = useWindowDimensions();
  const tokens = useMemo(() => parseChatMarkdown(body), [body]);
  const reveal = useMemo(() => createReplyReveal(tokens), [tokens]);
  const visibleTokens = useReplyPlayback(reveal, playback);
  const codeColor = useThemeColor("foreground");
  const { t } = useText();
  // A reply turns into native text views once it has stopped streaming and its words have all
  // shown, so the reveal keeps its fading words. The views then hold the same text in place.
  const revealed =
    !streaming &&
    (!playback?.enabled || (playback.complete && (playback.progress.get(playback.id) ?? 0) >= reveal.words.length));
  const generation = nativeSelection?.generation;
  const onSelect = nativeSelection?.onSelect;
  const selectionReport = useRef<{ paragraph: string | null; timer?: ReturnType<typeof setTimeout> }>({
    paragraph: null,
  });
  useEffect(() => () => clearTimeout(selectionReport.current.timer), []);
  const nativeTarget = useMemo<NativeSelectionTarget | undefined>(() => {
    if (generation === undefined || !onSelect) return undefined;
    return {
      generation,
      // One paragraph holds the selection at a time. Dragging a handle reports on each step, so
      // the text reaches the chat after a short pause; the end of a selection reaches it at once.
      report: (paragraph, selected) => {
        const state = selectionReport.current;
        clearTimeout(state.timer);
        if (selected) {
          state.paragraph = paragraph;
          state.timer = setTimeout(() => onSelect(selected), SELECTION_REPORT_DELAY_MS);
        } else if (state.paragraph === paragraph) {
          state.paragraph = null;
          onSelect("");
        }
      },
    };
  }, [generation, onSelect]);
  return (
    <StreamRevealProvider>
      <MarkdownBlocks
        tokens={visibleTokens}
        presentation={{
          selectable,
          type: compact ? "body-sm" : "body",
          style: { color: color ?? codeColor },
          codeColor,
          agents,
          mentionOffset: 4 * fontScale,
          fontScale,
          t,
          streaming,
          animateTail: (streaming || Boolean(playback?.enabled)) && animationEnabled && textReveal,
          nativeSelection: revealed ? nativeTarget : undefined,
        }}
      />
    </StreamRevealProvider>
  );
});
