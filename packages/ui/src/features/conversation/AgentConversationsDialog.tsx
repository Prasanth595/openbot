import { AGENT_CONVERSATION_LIMITS, type AgentConversationSummary } from "@openbot/contracts/ipc-agent-conversations";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Heading,
  IconButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  MessageCircle,
  Text,
  X,
} from "@openbot/ui";
import { createEffect, createStore, For, onSettled, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { useText } from "../../text";

export interface AgentConversationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: readonly AgentConversationSummary[];
  selectedThreadId: string | null;
  query: string;
  archived: boolean;
  loading: boolean;
  pending: boolean;
  error: string | null;
  hasMore: boolean;
  onQueryChange: (query: string) => void;
  onArchivedChange: (archived: boolean) => void;
  onSelect: (threadId: string) => void;
  onCreate: (label: string) => Promise<void>;
  onRename: (threadId: string, label: string) => Promise<void>;
  onArchive: (threadId: string, archived: boolean) => Promise<void>;
  onLoadMore: () => Promise<void>;
}

/** Lists local subjects. Execution remains limited to one turn for each agent. */
export function AgentConversationsDialog(props: AgentConversationsDialogProps) {
  const { t, format, errorMessage } = useText();
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  const [form, setForm] = createStore<{
    newLabel: string;
    newTouched: boolean;
    renameThreadId: string | null;
    renameLabel: string;
    renameTouched: boolean;
    archiveThreadId: string | null;
    archiveLabel: string;
    busy: boolean;
    error: string | null;
  }>({
    newLabel: "",
    newTouched: false,
    renameThreadId: null,
    renameLabel: "",
    renameTouched: false,
    archiveThreadId: null,
    archiveLabel: "",
    busy: false,
    error: null,
  });
  let running = false;
  const busy = () => props.pending || form.busy;
  const label = (conversation: AgentConversationSummary) =>
    conversation.label ??
    (conversation.main ? t("conversation.conversations.main") : t("conversation.conversations.untitled"));
  const archiveBlocked = (conversation: AgentConversationSummary) =>
    conversation.activeTurnId !== null || conversation.queuedCount > 0 || conversation.requiresInput;

  createEffect(
    () => props.open,
    (open) => {
      if (open) return;
      setForm((current) => {
        current.newLabel = "";
        current.newTouched = false;
        current.renameThreadId = null;
        current.renameLabel = "";
        current.renameTouched = false;
        current.archiveThreadId = null;
        current.archiveLabel = "";
        current.error = null;
      });
    },
  );

  function changeOpen(open: boolean): void {
    if (busy()) return;
    props.onOpenChange(open);
  }

  async function run(operation: () => Promise<void>, done?: () => void): Promise<void> {
    if (running || props.pending) return;
    running = true;
    setForm((current) => {
      current.busy = true;
      current.error = null;
    });
    try {
      await operation();
      done?.();
    } catch (error) {
      setForm((current) => {
        current.error = errorMessage(error, t("conversation.conversations.actionFailed"));
      });
    } finally {
      running = false;
      setForm((current) => {
        current.busy = false;
      });
    }
  }

  function create(): void {
    const name = form.newLabel.trim();
    setForm((current) => {
      current.newTouched = true;
    });
    if (!name) return;
    void run(
      () => props.onCreate(name),
      () => {
        setForm((current) => {
          current.newLabel = "";
          current.newTouched = false;
        });
      },
    );
  }

  function rename(): void {
    const threadId = form.renameThreadId;
    const name = form.renameLabel.trim();
    setForm((current) => {
      current.renameTouched = true;
    });
    if (!threadId || !name) return;
    void run(
      () => props.onRename(threadId, name),
      () => {
        setForm((current) => {
          current.renameThreadId = null;
          current.renameLabel = "";
          current.renameTouched = false;
        });
      },
    );
  }

  const emptyText = () => {
    if (props.query.trim()) return t("conversation.conversations.emptySearch");
    return props.archived ? t("conversation.conversations.emptyArchived") : t("conversation.conversations.empty");
  };

  return (
    <>
      <Dialog.Root open={props.open} onOpenChange={changeOpen}>
        <Dialog.Portal>
          <Dialog.Overlay class="custom-provider-backdrop">
            <Dialog.Content
              as="section"
              class="custom-provider-dialog agent-conversations-dialog"
              aria-busy={busy() || props.loading ? "true" : "false"}
            >
              <Dialog.Title class="sr-only">{t("conversation.conversations.title")}</Dialog.Title>
              <Dialog.Description class="sr-only">{t("conversation.conversations.description")}</Dialog.Description>
              <header class="custom-provider-header">
                <span class="custom-provider-mark" aria-hidden="true">
                  <MessageCircle />
                </span>
                <div class="custom-provider-title">
                  <Heading as="h2" size="md">
                    {t("conversation.conversations.title")}
                  </Heading>
                  <Text tone="muted" variant="caption">
                    {t("conversation.conversations.serialNotice")}
                  </Text>
                </div>
                <IconButton
                  class="custom-provider-close"
                  label={t("common.close")}
                  variant="ghost"
                  disabled={busy()}
                  onClick={() => changeOpen(false)}
                >
                  <X />
                </IconButton>
              </header>
              <div class="custom-provider-body">
                <div class={["custom-provider-list", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
                  <Field label={t("conversation.conversations.search")}>
                    <Input
                      type="search"
                      value={props.query}
                      maxlength={AGENT_CONVERSATION_LIMITS.query}
                      disabled={busy()}
                      onValueChange={props.onQueryChange}
                    />
                  </Field>
                  <fieldset class="agent-conversations-filters" aria-label={t("conversation.conversations.title")}>
                    <Button
                      type="button"
                      variant={props.archived ? "ghost" : "secondary"}
                      size="sm"
                      aria-pressed={props.archived ? "false" : "true"}
                      disabled={busy()}
                      onClick={() => props.onArchivedChange(false)}
                    >
                      {t("conversation.conversations.active")}
                    </Button>
                    <Button
                      type="button"
                      variant={props.archived ? "secondary" : "ghost"}
                      size="sm"
                      aria-pressed={props.archived ? "true" : "false"}
                      disabled={busy()}
                      onClick={() => props.onArchivedChange(true)}
                    >
                      {t("conversation.conversations.archived")}
                    </Button>
                  </fieldset>
                  <Show when={props.archived}>
                    <Text tone="muted" variant="caption">
                      {t("conversation.conversations.archivedNotice")}
                    </Text>
                  </Show>
                  <Show when={form.error ?? props.error}>
                    {(message) => (
                      <Alert tone="danger" report={false} role="alert">
                        <AlertContent>
                          <AlertDescription>
                            {errorMessage(message(), t("conversation.conversations.actionFailed"))}
                          </AlertDescription>
                        </AlertContent>
                      </Alert>
                    )}
                  </Show>
                  <Show when={props.loading}>
                    <Text tone="muted" variant="caption" role="status">
                      {t("conversation.conversations.loading")}
                    </Text>
                  </Show>
                  <Show
                    when={props.conversations.length > 0}
                    fallback={
                      !props.loading && (
                        <Text class="custom-provider-list-empty" tone="muted" variant="caption">
                          {emptyText()}
                        </Text>
                      )
                    }
                  >
                    <ItemGroup surface="subtle" aria-label={t("conversation.conversations.title")}>
                      <For each={props.conversations}>
                        {(conversation) => (
                          <Item class="agent-conversations-row">
                            <ItemContent>
                              <Show
                                when={form.renameThreadId === conversation.threadId}
                                fallback={
                                  <>
                                    <ItemTitle class="agent-conversations-title">
                                      <Button
                                        class="agent-conversations-select"
                                        type="button"
                                        variant="link"
                                        size="sm"
                                        aria-label={t("conversation.conversations.openNamed", {
                                          name: label(conversation),
                                        })}
                                        aria-current={
                                          props.selectedThreadId === conversation.threadId ? "true" : undefined
                                        }
                                        disabled={busy()}
                                        onClick={() => {
                                          props.onSelect(conversation.threadId);
                                          props.onOpenChange(false);
                                        }}
                                      >
                                        {label(conversation)}
                                      </Button>
                                    </ItemTitle>
                                    <ItemDescription>
                                      {format.date(new Date(conversation.updatedAt), {
                                        dateStyle: "medium",
                                        timeStyle: "short",
                                      })}
                                    </ItemDescription>
                                    <div class="agent-conversations-status">
                                      <Show when={conversation.main}>
                                        <Badge variant="secondary">{t("conversation.conversations.main")}</Badge>
                                      </Show>
                                      <Show when={props.selectedThreadId === conversation.threadId}>
                                        <Badge variant="outline">{t("conversation.conversations.selected")}</Badge>
                                      </Show>
                                      <Show when={conversation.activeTurnId !== null}>
                                        <Badge variant="info-light">{t("conversation.conversations.working")}</Badge>
                                      </Show>
                                      <Show when={conversation.queuedCount > 0}>
                                        <Badge variant="secondary">
                                          {t("conversation.conversations.queued")}{" "}
                                          {format.number(conversation.queuedCount)}
                                        </Badge>
                                      </Show>
                                      <Show when={conversation.requiresInput}>
                                        <Badge variant="warning-light">
                                          {t("conversation.conversations.inputRequired")}
                                        </Badge>
                                      </Show>
                                    </div>
                                  </>
                                }
                              >
                                <form
                                  class="agent-conversations-rename"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    rename();
                                  }}
                                >
                                  <Field
                                    label={t("conversation.conversations.name")}
                                    required
                                    error={
                                      form.renameTouched && !form.renameLabel.trim()
                                        ? t("conversation.conversations.nameRequired")
                                        : undefined
                                    }
                                  >
                                    <Input
                                      value={form.renameLabel}
                                      maxlength={AGENT_CONVERSATION_LIMITS.label}
                                      disabled={busy()}
                                      onValueChange={(value) =>
                                        setForm((current) => {
                                          current.renameLabel = value;
                                        })
                                      }
                                    />
                                  </Field>
                                  <ItemActions>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      disabled={busy()}
                                      onClick={() =>
                                        setForm((current) => {
                                          current.renameThreadId = null;
                                          current.renameTouched = false;
                                        })
                                      }
                                    >
                                      {t("common.cancel")}
                                    </Button>
                                    <Button
                                      type="submit"
                                      variant="secondary"
                                      size="sm"
                                      disabled={busy() || !form.renameLabel.trim()}
                                    >
                                      {t("common.save")}
                                    </Button>
                                  </ItemActions>
                                </form>
                              </Show>
                            </ItemContent>
                            <Show when={form.renameThreadId !== conversation.threadId}>
                              <ItemActions class="agent-conversations-row-actions">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy()}
                                  onClick={() =>
                                    setForm((current) => {
                                      current.renameThreadId = conversation.threadId;
                                      current.renameLabel = conversation.label ?? "";
                                      current.renameTouched = false;
                                      current.error = null;
                                    })
                                  }
                                >
                                  {t("common.rename")}
                                </Button>
                                <Show when={!conversation.main}>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={
                                      busy() || (conversation.archivedAt === null && archiveBlocked(conversation))
                                    }
                                    onClick={() => {
                                      if (conversation.archivedAt !== null) {
                                        void run(() => props.onArchive(conversation.threadId, false));
                                        return;
                                      }
                                      setForm((current) => {
                                        current.archiveThreadId = conversation.threadId;
                                        current.archiveLabel = label(conversation);
                                        current.error = null;
                                      });
                                    }}
                                  >
                                    {conversation.archivedAt === null
                                      ? t("conversation.conversations.archive")
                                      : t("conversation.conversations.restore")}
                                  </Button>
                                </Show>
                              </ItemActions>
                            </Show>
                          </Item>
                        )}
                      </For>
                    </ItemGroup>
                  </Show>
                  <Show when={props.hasMore}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy() || props.loading}
                      onClick={() => void run(props.onLoadMore)}
                    >
                      {t("conversation.conversations.loadMore")}
                    </Button>
                  </Show>
                </div>
                <form
                  class="custom-provider-actions agent-conversations-create"
                  onSubmit={(event) => {
                    event.preventDefault();
                    create();
                  }}
                >
                  <Field
                    label={t("conversation.conversations.name")}
                    required
                    error={
                      form.newTouched && !form.newLabel.trim()
                        ? t("conversation.conversations.nameRequired")
                        : undefined
                    }
                  >
                    <Input
                      value={form.newLabel}
                      maxlength={AGENT_CONVERSATION_LIMITS.label}
                      disabled={busy()}
                      onValueChange={(value) =>
                        setForm((current) => {
                          current.newLabel = value;
                        })
                      }
                    />
                  </Field>
                  <Button type="submit" disabled={busy() || !form.newLabel.trim()}>
                    {t("conversation.conversations.create")}
                  </Button>
                </form>
              </div>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        open={props.open && form.archiveThreadId !== null}
        tone="default"
        icon={<MessageCircle />}
        title={t("conversation.conversations.archiveTitle", { name: form.archiveLabel })}
        description={t("conversation.conversations.archiveDescription")}
        confirmLabel={t("conversation.conversations.archive")}
        pending={busy()}
        error={
          form.error || props.error
            ? errorMessage(form.error ?? props.error, t("conversation.conversations.actionFailed"))
            : undefined
        }
        initialFocus="cancel"
        onCancel={() =>
          setForm((current) => {
            current.archiveThreadId = null;
            current.error = null;
          })
        }
        onConfirm={() => {
          const threadId = form.archiveThreadId;
          if (!threadId) return;
          return run(
            () => props.onArchive(threadId, true),
            () =>
              setForm((current) => {
                current.archiveThreadId = null;
              }),
          );
        }}
      />
    </>
  );
}
