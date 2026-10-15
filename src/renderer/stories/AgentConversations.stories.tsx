import type { AgentConversationSummary } from "@openbot/contracts/ipc-agent-conversations";
import { sourceText } from "@openbot/i18n/source";
import { Button } from "@openbot/ui";
import {
  AgentConversationsDialog,
  type AgentConversationsDialogProps,
} from "@openbot/ui/features/conversation/AgentConversationsDialog";
import { useText } from "@openbot/ui/text";
import { createMemo, createStore, untrack } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AgentConversationsControllerFixture } from "./agent-conversations-controller-fixture";

const updatedAt = "2026-10-15T09:00:00.000Z";
const main: AgentConversationSummary = {
  agentId: "story-agent",
  threadId: "story-main",
  main: true,
  label: null,
  archivedAt: null,
  updatedAt,
  activeTurnId: null,
  queuedCount: 0,
  requiresInput: false,
};
const wiki: AgentConversationSummary = {
  ...main,
  threadId: "story-wiki",
  main: false,
  label: "Personal wiki",
};
const travel: AgentConversationSummary = {
  ...wiki,
  threadId: "story-travel",
  label: "Travel plans",
};

type StoryProps = Pick<
  AgentConversationsDialogProps,
  "conversations" | "selectedThreadId" | "archived" | "pending" | "error" | "loading" | "hasMore"
>;

/** Local visual fixtures only. The production controller and service are checked separately. */
function ConversationListStory(props: StoryProps) {
  const { t } = useText();
  // The caller seeds this isolated playground once. All subsequent edits use its local state.
  const [state, setState] = createStore(
    untrack(() => ({
      open: true,
      rows: props.conversations.map((conversation) => ({ ...conversation })),
      selectedThreadId: props.selectedThreadId,
      archived: props.archived,
      query: "",
      moreLoaded: false,
    })),
  );
  let sequence = 0;
  const visible = createMemo(() => {
    const query = state.query.trim().toLowerCase();
    return state.rows.filter(
      (conversation) =>
        (conversation.archivedAt !== null) === state.archived &&
        (!query || (conversation.label ?? t("conversation.conversations.main")).toLowerCase().includes(query)),
    );
  });

  return (
    <main class="foundation-story foundation-interaction-stage">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          setState((current) => {
            current.open = true;
          })
        }
      >
        {t("conversation.conversations.open")}
      </Button>
      <AgentConversationsDialog
        open={state.open}
        onOpenChange={(open) =>
          setState((current) => {
            current.open = open;
          })
        }
        conversations={visible()}
        selectedThreadId={state.selectedThreadId}
        query={state.query}
        archived={state.archived}
        loading={props.loading}
        pending={props.pending}
        error={props.error}
        hasMore={props.hasMore && !state.moreLoaded}
        onQueryChange={(query) =>
          setState((current) => {
            current.query = query;
          })
        }
        onArchivedChange={(archived) =>
          setState((current) => {
            current.archived = archived;
          })
        }
        onSelect={(threadId) =>
          setState((current) => {
            current.selectedThreadId = threadId;
          })
        }
        onCreate={async (label) => {
          const threadId = `story-created-${++sequence}`;
          setState((current) => {
            current.rows.push({ ...wiki, threadId, label });
            current.selectedThreadId = threadId;
            current.archived = false;
            current.query = "";
          });
        }}
        onRename={async (threadId, label) => {
          setState((current) => {
            const conversation = current.rows.find((row) => row.threadId === threadId);
            if (conversation) conversation.label = label;
          });
        }}
        onArchive={async (threadId, archived) => {
          setState((current) => {
            const conversation = current.rows.find((row) => row.threadId === threadId);
            if (conversation) conversation.archivedAt = archived ? updatedAt : null;
          });
        }}
        onLoadMore={async () => {
          setState((current) => {
            current.rows.push({ ...travel, threadId: "story-more", label: "Reading notes" });
            current.moreLoaded = true;
          });
        }}
      />
    </main>
  );
}

const meta = {
  title: "Conversation/AgentConversations",
  component: ConversationListStory,
  args: {
    conversations: [main, wiki, travel],
    selectedThreadId: main.threadId,
    archived: false,
    pending: false,
    error: null,
    loading: false,
    hasMore: false,
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof ConversationListStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { conversations: [], selectedThreadId: null } };
export const LongLocalizedLabels: Story = {
  args: {
    conversations: [
      main,
      {
        ...wiki,
        label:
          "Persönliche Wissenssammlung für Reiseplanung und wiederkehrende Aufgaben mit ausführlichen Notizen zur Vorbereitung",
      },
      { ...travel, label: "家族旅行の準備と日程調整のための記録と次の打ち合わせで確認する詳しい項目" },
      { ...wiki, threadId: "story-long-word", label: "Wissenssammlungszusammenfassungsüberarbeitung".repeat(3) },
    ],
    hasMore: true,
  },
};
export const Working: Story = {
  args: {
    conversations: [main, { ...wiki, activeTurnId: "story-active-turn" }, travel],
    selectedThreadId: wiki.threadId,
  },
};
export const Queued: Story = {
  args: {
    conversations: [main, { ...wiki, activeTurnId: "story-active-turn" }, { ...travel, queuedCount: 3 }],
    selectedThreadId: travel.threadId,
  },
};
export const Archived: Story = {
  args: { conversations: [main, { ...wiki, archivedAt: updatedAt }], selectedThreadId: wiki.threadId, archived: true },
};
export const InputRequired: Story = {
  args: {
    conversations: [main, { ...wiki, activeTurnId: "story-input-turn", requiresInput: true }, travel],
    selectedThreadId: wiki.threadId,
  },
};
export const Pending: Story = { args: { pending: true } };
export const Loading: Story = { args: { conversations: [], loading: true } };
export const ActionFailed: Story = {
  args: { error: sourceText("error.agent.conversationBusy") },
};

/** Owned loopback service fixture. The external script supplies its guarded bridge. */
export const ControllerFixture: Story = { render: () => <AgentConversationsControllerFixture /> };
