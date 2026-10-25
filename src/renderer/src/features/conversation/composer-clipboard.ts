import {
  attachmentReferenceIds,
  expandAttachmentReferences,
  serializeAttachmentReference,
} from "@openbot/contracts/attachment-references";
import { expandChatTagReferences } from "@openbot/contracts/chat-tag-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AttachmentSummary, FilePreview } from "@openbot/contracts/ipc";
import { expandComposerMentions } from "@openbot/ui/features/conversation/ComposerEditor";
import { currentText } from "@openbot/ui/text";
import { Option, Schema } from "effect";

// Follows T3's context-fragment design: keep file bytes outside the clipboard payload and retain
// the latest copy independently of the source draft. No source paths or URLs come from a paste.
// The clipboard gets readable text and an HTML copy ID; the references stay in memory with the files.
const HTML_ATTRIBUTE = "data-openbot-composer-fragment";
const decodeFragment = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(1),
      copyId: Schema.String.check(Schema.isMaxLength(128)),
    }),
  ),
);
type PreviewAttachment = (attachment: AttachmentSummary) => Promise<FilePreview>;
interface CopiedAttachment {
  attachment: AttachmentSummary;
  file: Promise<File>;
}
interface ComposerCopy {
  id: string;
  text: string;
  files: CopiedAttachment[];
}
/** The text of a pasted copy, with references to `sourceIds`. The paste replaces them with `files`, in order. */
export interface PastedComposerCopy {
  text: string;
  sourceIds: string[];
  files: Promise<File>[];
}

const attachmentFiles = new WeakMap<AttachmentSummary, Promise<File>>();
let latestCopy: ComposerCopy | null = null;

export function rememberComposerFile(attachment: AttachmentSummary, file: File): void {
  attachmentFiles.set(attachment, Promise.resolve(file));
}

function attachmentFile(attachment: AttachmentSummary, preview?: PreviewAttachment): Promise<File> {
  const cached = attachmentFiles.get(attachment);
  if (cached) return cached;
  const file = (async () => {
    if (attachment.previewUrl) {
      const response = await fetch(attachment.previewUrl);
      if (!response.ok) throw new Error(currentText().t("attachment.previewUnavailable"));
      return new File([await response.blob()], attachment.name, { type: attachment.mimeType });
    }
    const result = await preview?.(attachment);
    if (!result?.bytes) throw new Error(currentText().t("attachment.previewUnavailable"));
    return new File([new Uint8Array(result.bytes)], attachment.name, { type: attachment.mimeType });
  })();
  attachmentFiles.set(attachment, file);
  // Copy events cannot await disk/network reads. A later paste reports the retained failure.
  void file.catch(() => attachmentFiles.delete(attachment));
  return file;
}

function createCopy(text: string, attachments: AttachmentSummary[], preview?: PreviewAttachment): ComposerCopy {
  const referenced = attachmentReferenceIds(text);
  const extra = attachments
    .filter((attachment) => !referenced.has(attachment.id))
    .map((attachment) => serializeAttachmentReference(attachment.name, attachment.id));
  const copy: ComposerCopy = {
    id: crypto.randomUUID(),
    text: [text, ...extra].filter(Boolean).join(" "),
    files: attachments.map((attachment) => ({ attachment, file: attachmentFile(attachment, preview) })),
  };
  latestCopy = copy;
  return copy;
}

// The async clipboard API writes no custom MIME type, so the copy ID is in the HTML for both copy paths.
function fragmentHtml(copy: ComposerCopy, plainText: string): string {
  const pre = document.createElement("pre");
  pre.setAttribute(HTML_ATTRIBUTE, encodeURIComponent(JSON.stringify({ version: 1, copyId: copy.id })));
  pre.textContent = plainText;
  return pre.outerHTML;
}

export function copyComposerSelection(
  clipboard: DataTransfer,
  text: string,
  attachments: AttachmentSummary[],
  preview?: PreviewAttachment,
): void {
  const copy = createCopy(text, attachments, preview);
  const plainText = expandAttachmentReferences(expandChatTagReferences(expandComposerMentions(text)));
  clipboard.setData("text/plain", plainText);
  clipboard.setData("text/html", fragmentHtml(copy, plainText));
}

export async function copyMessageWithAttachments(
  body: string,
  plainText: string,
  attachments: AttachmentSummary[],
  preview?: PreviewAttachment,
): Promise<void> {
  const copy = createCopy(body, attachments, preview);
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/plain": new Blob([plainText], { type: "text/plain" }),
      "text/html": new Blob([fragmentHtml(copy, plainText)], { type: "text/html" }),
    }),
  ]);
}

export function readComposerCopy(clipboard: DataTransfer): PastedComposerCopy | null {
  const html = clipboard.getData("text/html");
  if (html.length > INPUT_LIMITS.messageText * 12) return null;
  const encoded = /data-openbot-composer-fragment=["']([^"']+)["']/u.exec(html)?.[1];
  if (!encoded) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (raw.length > 1024) return null;
  const value = Option.getOrNull(decodeFragment(raw));
  if (!value) return null;
  const copy = latestCopy;
  if (!copy || value.copyId !== copy.id) {
    // An expired copy pastes as an unavailable file: its text alone would lose the files it names.
    // A paste that stops before it reads the files does not observe the rejection.
    const unavailable = Promise.reject(new Error(currentText().t("attachment.previewUnavailable")));
    void unavailable.catch(() => undefined);
    return { text: "", sourceIds: [], files: [unavailable] };
  }
  return {
    text: copy.text,
    sourceIds: copy.files.map((entry) => entry.attachment.id),
    files: copy.files.map((entry) => entry.file),
  };
}
