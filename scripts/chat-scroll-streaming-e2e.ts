// Checks that the reader can scroll away from a reply that is still arriving, in a running Storybook
// that renders the real conversation timeline against the preview mock. Read-only. Pass the URL that
// `bun run storybook` reports: `bun scripts/chat-scroll-streaming-e2e.ts --storybook=http://localhost:6006`.
// The chat must follow the reply while the reader is at the bottom, also after a sideways swipe, hold
// still after a short scroll up and after a long one, follow again when the reader goes back to the
// bottom, and hold still after a scroll up with the arrow key.
// It checks a history of 40 rows, which the timeline draws whole, and one of 120, which it virtualizes.
// Writes .openbot-build/chat-scroll-streaming-e2e/report.json and one screenshot per story.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright-core";

const OUT = resolve(import.meta.dirname, "../.openbot-build/chat-scroll-streaming-e2e");
const STORIES = [
  "conversation-conversation--streaming-while-reading-history",
  "conversation-conversation--streaming-while-reading-long-history",
];
const REPLY = '[data-chat-search-message="reading-history-reply"]';
/* Enough growth for several reveal steps of the reply and several resizes of the thinking line. */
const GROWTH = 400;
const TOLERANCE = 2;
const storybook = process.argv.find((arg) => arg.startsWith("--storybook="))?.slice("--storybook=".length);
assert.ok(storybook, "Pass --storybook=<url> with the URL that `bun run storybook` reports.");

interface Position {
  scrollTop: number;
  scrollHeight: number;
  distanceFromBottom: number;
  replyTop: number;
}

interface HoldResult {
  before: Position;
  after: Position;
  scrollTopMoved: number;
  replyMoved: number;
}

interface StoryResult {
  follows?: Position;
  followsAfterSidewaysSwipe?: Position;
  shortScrollUp?: HoldResult;
  longScrollUp?: HoldResult;
  followsAgain?: Position;
  arrowKeyScrollUp?: HoldResult;
}

interface Report {
  stories: Record<string, StoryResult>;
  passed: boolean;
}

const report: Report = { stories: {}, passed: false };

function position(page: Page): Promise<Position> {
  return page.evaluate((reply) => {
    const scroll = document.querySelector<HTMLElement>(".conversation-scroll");
    const row = document.querySelector<HTMLElement>(reply);
    if (!scroll || !row) throw new Error("The conversation or the reply is missing.");
    return {
      scrollTop: scroll.scrollTop,
      scrollHeight: scroll.scrollHeight,
      distanceFromBottom: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight,
      replyTop: row.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
    };
  }, REPLY);
}

/* The reply grows by itself; this waits for it to grow, then for the next two frames to paint. */
async function waitForGrowth(page: Page, from: number): Promise<void> {
  await page.waitForFunction(
    ([height, growth]) => (document.querySelector(".conversation-scroll")?.scrollHeight ?? 0) >= height + growth,
    [from, GROWTH] as const,
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(undefined)))),
  );
}

/*
 * An input, then the scroll event that moves the chat in its direction. A scroll event that the chat's
 * own follow queued before the input can arrive first.
 */
async function scrollWith(page: Page, up: boolean, input: () => Promise<void>): Promise<void> {
  const scrolled = page.evaluate((towardTop) => {
    const scroll = document.querySelector<HTMLElement>(".conversation-scroll");
    if (!scroll) throw new Error("The conversation is missing.");
    const from = scroll.scrollTop;
    return new Promise((done) => {
      const onScroll = () => {
        if (towardTop ? scroll.scrollTop >= from : scroll.scrollTop <= from) return;
        scroll.removeEventListener("scroll", onScroll);
        done(undefined);
      };
      scroll.addEventListener("scroll", onScroll);
    });
  }, up);
  await input();
  await scrolled;
}

function wheel(page: Page, deltaY: number): Promise<void> {
  return scrollWith(page, deltaY < 0, () => page.mouse.wheel(0, deltaY));
}

async function holds(page: Page, scrollUp: () => Promise<void>): Promise<HoldResult> {
  await scrollUp();
  const before = await position(page);
  await waitForGrowth(page, before.scrollHeight);
  const after = await position(page);
  return {
    before,
    after,
    scrollTopMoved: after.scrollTop - before.scrollTop,
    replyMoved: after.replyTop - before.replyTop,
  };
}

function assertHolds(story: string, name: string, hold: HoldResult): void {
  assert.ok(hold.after.distanceFromBottom > 80, `${story}: the chat went back to the bottom after ${name}.`);
  assert.ok(Math.abs(hold.scrollTopMoved) <= TOLERANCE, `${story}: the chat moved after ${name}.`);
  assert.ok(Math.abs(hold.replyMoved) <= TOLERANCE, `${story}: the reply moved after ${name}.`);
}

async function checkStory(page: Page, story: string, result: StoryResult): Promise<void> {
  await page.goto(`${storybook}/iframe.html?id=${story}&viewMode=story`);
  await page.locator(REPLY).waitFor();
  const box = await page.locator(".conversation-scroll").boundingBox();
  assert.ok(box, `${story}: the conversation has no box.`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // At the bottom, the chat follows the reply.
  await waitForGrowth(page, (await position(page)).scrollHeight);
  result.follows = await position(page);
  assert.ok(result.follows.distanceFromBottom <= 80, `${story}: the chat does not follow the reply at the bottom.`);

  // A sideways swipe with a small vertical delta, as a trackpad sends, does not stop the follow.
  await page.mouse.wheel(-60, -1);
  await waitForGrowth(page, (await position(page)).scrollHeight);
  result.followsAfterSidewaysSwipe = await position(page);
  assert.ok(
    result.followsAfterSidewaysSwipe.distanceFromBottom <= 80,
    `${story}: the chat stopped following the reply after a sideways swipe.`,
  );

  // A short scroll up, less than the distance that counted as the bottom, holds the chat still.
  // A longer scroll up holds it still too. Both are measured before either is checked.
  result.shortScrollUp = await holds(page, () => wheel(page, -40));
  result.longScrollUp = await holds(page, async () => {
    for (let step = 0; step < 8; step += 1) await wheel(page, -40);
  });
  await page.screenshot({ path: resolve(OUT, `${story.split("--")[1]}.png`) });
  assertHolds(story, "a short scroll up", result.shortScrollUp);
  assertHolds(story, "a long scroll up", result.longScrollUp);

  // Back at the bottom, the chat follows the reply again.
  await wheel(page, 100_000);
  await waitForGrowth(page, (await position(page)).scrollHeight);
  result.followsAgain = await position(page);
  assert.ok(
    result.followsAgain.distanceFromBottom <= 80,
    `${story}: the chat does not follow the reply again at the bottom.`,
  );

  // A click on the reply leaves the focus on the page; the arrow key then scrolls the chat up. The reply
  // keeps growing, so the click goes to a point and does not wait for the row to stop moving.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  result.arrowKeyScrollUp = await holds(page, () => scrollWith(page, true, () => page.keyboard.press("ArrowUp")));
  assertHolds(story, "a scroll up with the arrow key", result.arrowKeyScrollUp);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", args: ["--disable-smooth-scrolling"] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  for (const story of STORIES) {
    const result: StoryResult = {};
    report.stories[story] = result;
    await checkStory(page, story, result);
  }
  report.passed = true;
} finally {
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  await browser.close();
}
