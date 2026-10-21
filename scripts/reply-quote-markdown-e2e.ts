// Checks that a reply quote renders the original's Markdown in a running Storybook, which renders
// the real shared message body and the real conversation composer.
// Pass the URL that `bun run storybook` reports:
// `bun scripts/reply-quote-markdown-e2e.ts --storybook=http://localhost:6006`.
// Writes .openbot-build/reply-quote-markdown-e2e/report.json and screenshots.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/reply-quote-markdown-e2e");
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
const browserExecutable = process.argv
  .find((arg) => arg.startsWith("--browser-executable="))
  ?.slice("--browser-executable=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

interface QuoteShape {
  text: string;
  /** The rendered elements in document order, so two quotes of one message can be compared. */
  structure: string[];
  clipped: boolean;
}

interface Report {
  sent?: QuoteShape;
  composer?: QuoteShape;
  conversationSent?: QuoteShape;
  openFence?: QuoteShape & { replyText: string };
  passed: boolean;
}

const report: Report = { passed: false };

async function openStory(page: Page, id: string): Promise<void> {
  await page.goto(`${storybook}/iframe.html?id=${id}&viewMode=story`);
}

async function quoteShape(quote: Locator): Promise<QuoteShape> {
  await quote.waitFor({ timeout: 60_000 });
  return quote.evaluate((element) => ({
    text: element.textContent ?? "",
    structure: [...element.querySelectorAll("h1, h2, h3, p, ul, ol, li, strong, a, code, pre, b")].map((node) =>
      node.tagName.toLowerCase(),
    ),
    clipped: element.scrollHeight > element.clientHeight,
  }));
}

function assertMarkdownQuote(shape: QuoteShape, where: string): void {
  for (const tag of ["h2", "strong", "a", "code", "li", "pre"]) {
    assert.ok(shape.structure.includes(tag), `${where}: the quote must render <${tag}>.`);
  }
  assert.ok(!shape.text.includes("##"), `${where}: the heading marks must not show.`);
  assert.ok(!shape.text.includes("```"), `${where}: the code fence must not show.`);
  assert.ok(!shape.text.includes("`"), `${where}: the code span marks must not show.`);
  assert.ok(!shape.text.includes("**"), `${where}: the emphasis marks must not show.`);
  assert.ok(!shape.structure.includes("b"), `${where}: raw HTML must not become an element.`);
  assert.ok(shape.text.includes("<b>the notes</b>"), `${where}: raw HTML must show as text.`);
  assert.ok(shape.clipped, `${where}: a long quote must be cut to its maximum height.`);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  browserExecutable ? { executablePath: resolve(browserExecutable), args: ["--no-sandbox"] } : { channel: "chrome" },
);
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

  await openStory(page, "conversation-messagebody--reply-markdown-original");
  report.sent = await quoteShape(page.locator(".message-reply-context .message-reply-quote"));
  assertMarkdownQuote(report.sent, "Sent message");
  await page.locator(".message-reply-context").screenshot({ path: resolve(OUT, "sent-quote.png") });

  await openStory(page, "conversation-messagebody--reply-markdown-open-fence");
  const openFence = await quoteShape(page.locator(".message-reply-context .message-reply-quote"));
  assert.ok(openFence.structure.includes("pre"), "An open fence must still render as a code block.");
  assert.ok(openFence.clipped, "An open fence must be cut to the quote's maximum height.");
  const replyText = (await page.locator(".message-reply-context + *").first().textContent()) ?? "";
  assert.ok(replyText.includes("Approved."), "The reply under a quote with an open fence must render.");
  report.openFence = { ...openFence, replyText };
  await page.locator('[data-slot="bubble"]').screenshot({ path: resolve(OUT, "open-fence.png") });

  await page.setViewportSize({ width: 1100, height: 820 });
  await openStory(page, "conversation-conversation--markdown-reply-quote");
  report.composer = await quoteShape(page.locator(".composer-reply-preview .message-reply-quote"));
  assertMarkdownQuote(report.composer, "Composer preview");
  report.conversationSent = await quoteShape(page.locator(".message-reply-context .message-reply-quote"));
  assertMarkdownQuote(report.conversationSent, "Sent message in the chat");
  assert.deepEqual(
    report.composer.structure,
    report.conversationSent.structure,
    "The composer preview and the sent message must render the quote the same way.",
  );
  assert.equal(report.composer.text, report.conversationSent.text);
  await page.screenshot({ path: resolve(OUT, "conversation.png") });

  report.passed = true;
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
