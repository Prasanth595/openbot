import type { ConversationMessage, ConversationPage } from "@openbot/contracts/ipc";
import { decodeConversationPage } from "./conversation";
import { MobileConversationStore } from "./conversation-store";

function message(index: number, text = `Fixture message ${index}`): ConversationMessage {
  return {
    id: `cache-probe-message-${index}`,
    turnId: "cache-probe-turn",
    author: "assistant",
    source: "assistant",
    text,
    createdAt: "2026-10-22T00:00:00.000Z",
    status: "completed",
  };
}

function page(agentId: string, start = 50, revision = 10): ConversationPage {
  return decodeConversationPage({
    agentId,
    threadId: "cache-probe-thread",
    activeTurnId: null,
    revision,
    messages: Array.from({ length: 50 }, (_, index) => message(start + index)),
    references: { "cache-probe-reference": message(1000 + start) },
    pageInfo: { hasOlder: true, olderCursor: `cache-probe-cursor-${start}` },
  });
}

function deferredPage() {
  let resolve: (page: ConversationPage) => void = () => {};
  const promise = new Promise<ConversationPage>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

/** Uses synthetic data and the real cache service, from the development preview or the E2E script. */
export async function runConversationCacheProbe(): Promise<Record<string, boolean>> {
  let clock = 0;
  let clockReads = 0;
  const store = new MobileConversationStore(
    () => () => {},
    () => {
      clockReads++;
      return clock;
    },
  );
  const checks: Record<string, boolean> = {};
  const host = "cache-probe-host";
  const agent = "cache-probe-agent";
  const latest = page(agent);
  const releases: (() => void)[] = [];
  try {
    checks.coldStartHasNoChat = store.get(agent, host) === undefined;
    const pending = deferredPage();
    let reads = 0;
    const read = () => {
      reads++;
      return pending.promise;
    };
    const first = store.loadLatest(host, agent, read, () => true);
    const second = store.loadLatest(host, agent, read, () => true);
    await Promise.resolve();
    checks.prefetchAndOpenShareOneRead = first === second && reads === 1;
    pending.resolve(latest);
    await first;
    checks.latestPageHasFiftyMessages = store.get(agent, host)?.messages.length === 50;
    const snapshot = store.get(agent, host);
    const readsBeforeSnapshot = clockReads;
    checks.snapshotReadKeepsIdentity = Array.from({ length: 10 }, () => store.get(agent, host)).every(
      (value) => value === snapshot,
    );
    checks.snapshotReadDoesNoCacheMaintenance = clockReads === readsBeforeSnapshot;

    const releasePending = store.subscribe(agent, host, () => {});
    const lateOlder = deferredPage();
    const lateLoad = store.loadOlder(
      host,
      agent,
      () => lateOlder.promise,
      () => true,
    );
    checks.pendingOlderPageShowsLoading = store.get(agent, host)?.olderLoading === true;
    releasePending();
    const restored = store.get(agent, host);
    lateOlder.resolve(page(agent, 0));
    await lateLoad;
    checks.closedChatRejectsLateOlderPage = store.get(agent, host) === restored && restored?.messages.length === 50;
    checks.closedChatClearsOlderLoading = restored?.olderLoading === false;

    const releaseReopened = store.subscribe(agent, host, () => {});
    const previousOlder = deferredPage();
    const previousLoad = store.loadOlder(
      host,
      agent,
      () => previousOlder.promise,
      () => true,
    );
    releaseReopened();
    const releaseNewReader = store.subscribe(agent, host, () => {});
    const nextOlder = deferredPage();
    const nextLoad = store.loadOlder(
      host,
      agent,
      () => nextOlder.promise,
      () => true,
    );
    previousOlder.resolve(page(agent, 0));
    await previousLoad;
    checks.reopenedChatRejectsPreviousOlderPage = store.get(agent, host)?.messages.length === 50;
    checks.previousLoadDoesNotClearNewLoading = store.get(agent, host)?.olderLoading === true;
    nextOlder.resolve(page(agent, 0));
    await nextLoad;
    checks.reopenedChatCanLoadOlderPage =
      store.get(agent, host)?.messages.length === 100 && store.get(agent, host)?.olderLoading === false;
    releaseNewReader();

    const unsubscribe = store.subscribe(agent, host, () => {});
    let olderCursor: string | undefined;
    await store.loadOlder(
      host,
      agent,
      async (cursor) => {
        olderCursor = cursor;
        return page(agent, 0);
      },
      () => true,
    );
    checks.paginationUsesOriginalCursor = olderCursor === latest.pageInfo.olderCursor;
    checks.activeChatCanExpand = store.get(agent, host)?.messages.length === 100;
    store.applyAround(page(agent, 200), host);
    checks.searchWindowIsDetached = store.get(agent, host)?.detached === true;
    unsubscribe();
    const reopened = store.get(agent, host);
    checks.reopenKeepsExactLatestPage = JSON.stringify(reopened?.messages) === JSON.stringify(latest.messages);
    checks.reopenKeepsOriginalCursor = JSON.stringify(reopened?.pageInfo) === JSON.stringify(latest.pageInfo);
    checks.reopenKeepsOriginalReferences = JSON.stringify(reopened?.references) === JSON.stringify(latest.references);
    checks.reopenDropsDetachedWindow = reopened?.detached === false;
    store.applyPage(page(agent, 40, 9), host);
    checks.olderRevisionCannotReplacePage = store.get(agent, host)?.revision === 10;
    const savedMessage = store.get(agent, host)?.messages[0];
    store.applyPage(page(agent), host);
    checks.equalMessagesKeepIdentity = store.get(agent, host)?.messages[0] === savedMessage;

    const releaseStream = store.subscribe(agent, host, () => {});
    store.enqueue(
      {
        type: "conversation-delta",
        agentId: agent,
        threadId: "cache-probe-thread",
        turnId: "cache-probe-turn",
        messageId: "cache-probe-streaming-message",
        delta: "Fixture stream",
        createdAt: "2026-10-22T00:00:00.000Z",
        revision: 12,
      },
      host,
    );
    store.flush();
    checks.activeStreamUpdatesVisibleChat = store.get(agent, host)?.revision === 12;
    releaseStream();
    store.applyPage(page(agent, 55, 11), host);
    checks.closedStreamRejectsEarlierPage = store.get(agent, host)?.revision === 10;
    store.applyPage(page(agent, 60, 12), host);
    checks.completePageAfterStreamCanRefresh = store.get(agent, host)?.revision === 12;

    store.applyPage(page(agent, 300), "cache-probe-other-host");
    checks.sameAgentIdsStaySeparateByHost =
      store.get(agent, host)?.messages[0]?.id !== store.get(agent, "cache-probe-other-host")?.messages[0]?.id;
    store.removeServer("cache-probe-other-host");
    checks.hostAccessLossClearsOnlyThatHost =
      store.get(agent, "cache-probe-other-host") === undefined && store.get(agent, host) !== undefined;

    const stale = deferredPage();
    const staleLoad = store.loadLatest(
      host,
      "cache-probe-removed",
      () => stale.promise,
      () => true,
    );
    store.remove("cache-probe-removed", host);
    stale.resolve(page("cache-probe-removed"));
    await staleLoad;
    checks.removedAccessRejectsLateResponse = store.get("cache-probe-removed", host) === undefined;
    const cancelled = deferredPage();
    const cancelledLoad = store.loadLatest(
      host,
      agent,
      () => cancelled.promise,
      () => true,
    );
    store.cancelRequests();
    await store.loadLatest(
      host,
      agent,
      async () => page(agent, 60, 12),
      () => true,
    );
    cancelled.resolve(page(agent, 50, 11));
    await cancelledLoad;
    checks.oldConnectionCannotOverwriteNewRead = store.get(agent, host)?.revision === 12;

    store.dispose();
    const active = "cache-probe-active";
    const release = store.subscribe(active, host, () => {});
    releases.push(release);
    store.applyPage(page(active), host);
    for (let index = 0; index < 6; index++) {
      clock++;
      store.applyPage(page(`cache-probe-recent-${index}`), host);
    }
    checks.fiveInactiveChatsEvictOldest =
      store.get("cache-probe-recent-0", host) === undefined &&
      [1, 2, 3, 4, 5].every((index) => store.get(`cache-probe-recent-${index}`, host) !== undefined);
    checks.activeChatIsOutsideCountLimit = store.get(active, host) !== undefined;
    clock += 10 * 60_000;
    // A page update runs maintenance at the advanced clock without waiting ten real minutes.
    store.applyPage(page(active), host);
    checks.inactivePagesExpireAfterTenMinutes = [1, 2, 3, 4, 5].every(
      (index) => store.get(`cache-probe-recent-${index}`, host) === undefined,
    );
    checks.activeChatDoesNotExpire = store.get(active, host) !== undefined;
    release();
    checks.expiryStartsWhenActiveChatCloses = store.get(active, host) !== undefined;
    store.dispose();

    const largeActive = "cache-probe-large-active";
    const releaseLarge = store.subscribe(largeActive, host, () => {});
    releases.push(releaseLarge);
    const large = (id: string) => ({ ...page(id), messages: [message(1, "x".repeat(6 * 1024 * 1024))] });
    store.applyPage(large(largeActive), host);
    clock++;
    store.applyPage(large("cache-probe-large-one"), host);
    checks.activePayloadIsOutsideByteLimit =
      store.get(largeActive, host) !== undefined && store.get("cache-probe-large-one", host) !== undefined;
    clock++;
    store.applyPage(large("cache-probe-large-two"), host);
    checks.combinedInactivePayloadHasTenMiBLimit =
      store.get("cache-probe-large-one", host) === undefined && store.get("cache-probe-large-two", host) !== undefined;
    store.dispose();
    checks.signOutDisposalClearsAllPages =
      store.get(largeActive, host) === undefined && store.get("cache-probe-large-two", host) === undefined;
    const cold = new MobileConversationStore(() => () => {});
    checks.nextSessionStartsEmpty = cold.get(agent, host) === undefined;
    cold.dispose();
    return checks;
  } finally {
    for (const release of releases) release();
    store.dispose();
  }
}
