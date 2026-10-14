import {
  type AgentMemoryDirectoryMetadata,
  MEMORY_DIRECTORY_LIMITS,
  type MemoryDirectoryAnnotation,
  memoryDirectoryAnnotationBytes,
} from "@openbot/contracts/agent-memory-directory";
import { Button, Field, Input, Textarea } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, Show, untrack } from "solid-js";
import type { MemoriesPort } from "./memories-port";

interface MemoryDirectoryEditorProps {
  memoryId: string;
  memoryUpdatedAt: string;
  memoryRevision: number;
  port: NonNullable<MemoriesPort["directory"]>;
  disabled: boolean;
}

/** Optional labels have a separate save, so an error cannot undo a saved text correction. */
export function MemoryDirectoryEditor(props: MemoryDirectoryEditorProps) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{
    phase: "loading" | "ready" | "unavailable" | "failed";
    metadata: AgentMemoryDirectoryMetadata | null;
    title: string;
    aliases: string;
    saving: boolean;
    error: string | null;
  }>({ phase: "loading", metadata: null, title: "", aliases: "", saving: false, error: null });
  let generation = 0;

  async function load(): Promise<void> {
    const token = ++generation;
    const port = props.port;
    const memoryId = props.memoryId;
    setState((draft) => {
      draft.phase = "loading";
      draft.error = null;
      draft.saving = false;
    });
    try {
      const metadata = await port.read(memoryId);
      if (token !== generation) return;
      setState((draft) => {
        draft.phase = metadata ? "ready" : "unavailable";
        draft.metadata = metadata;
        draft.title = metadata?.titleKind === "explicit" ? metadata.title : "";
        draft.aliases = metadata?.aliases.join("\n") ?? "";
      });
    } catch (error) {
      if (token !== generation) return;
      setState((draft) => {
        draft.phase = "failed";
        draft.error = errorMessage(error, t("memory.directory.loadFailed"));
      });
    }
  }

  createEffect(
    () => [props.memoryId, props.memoryUpdatedAt, props.memoryRevision, props.port] as const,
    () => {
      void untrack(load);
      return () => {
        generation += 1;
      };
    },
  );

  function annotation(): MemoryDirectoryAnnotation {
    return {
      title: state.title.trim() || null,
      aliases: state.aliases
        .split(/\r?\n/u)
        .map((alias) => alias.trim())
        .filter(Boolean),
    };
  }

  function invalid(): boolean {
    const value = annotation();
    return (
      value.aliases.length > MEMORY_DIRECTORY_LIMITS.aliases ||
      value.aliases.some((alias) => alias.length > MEMORY_DIRECTORY_LIMITS.alias) ||
      (value.title === null && value.aliases.length > 0) ||
      memoryDirectoryAnnotationBytes(value) > MEMORY_DIRECTORY_LIMITS.annotationBytes
    );
  }

  async function save(remove = false): Promise<void> {
    const metadata = state.metadata;
    if (!metadata || state.saving || props.disabled || (!remove && invalid())) return;
    const token = generation;
    const port = props.port;
    const value = remove ? { title: null, aliases: [] } : annotation();
    setState((draft) => {
      draft.saving = true;
      draft.error = null;
    });
    try {
      const saved = await port.set({
        memoryId: metadata.memoryId,
        expectedMemoryRevision: metadata.memoryRevision,
        expectedAnnotationRevision: metadata.annotationRevision,
        ...value,
      });
      if (token !== generation) return;
      setState((draft) => {
        draft.metadata = saved;
        draft.title = saved.titleKind === "explicit" ? saved.title : "";
        draft.aliases = saved.aliases.join("\n");
      });
    } catch (error) {
      if (token !== generation) return;
      setState((draft) => {
        draft.error = errorMessage(error, t("memory.directory.saveFailed"));
      });
    } finally {
      if (token === generation)
        setState((draft) => {
          draft.saving = false;
        });
    }
  }

  return (
    <Show when={state.phase !== "unavailable"}>
      <section class="agent-memory-editor agent-memory-directory-editor" aria-label={t("memory.directory.label")}>
        <Show when={state.phase === "loading"}>
          <p class="agent-memory-meta">{t("memory.directory.loading")}</p>
        </Show>
        <Show when={state.phase === "ready" && state.metadata}>
          {(metadata) => (
            <>
              <p class="agent-memory-meta">{t("memory.directory.explanation")}</p>
              <p class="agent-memory-meta">
                {metadata().titleKind === "current-text-excerpt"
                  ? t("memory.directory.fallback")
                  : metadata().actor === "user"
                    ? t("memory.directory.userLabels")
                    : t("memory.directory.agentLabels")}
              </p>
              <Field label={t("memory.directory.title")}>
                <Input
                  value={state.title}
                  maxlength={MEMORY_DIRECTORY_LIMITS.title}
                  disabled={state.saving || props.disabled}
                  onValueChange={(value) =>
                    setState((draft) => {
                      draft.title = value;
                    })
                  }
                />
              </Field>
              <Field label={t("memory.directory.aliases")} description={t("memory.directory.aliasHelp")}>
                <Textarea
                  rows="2"
                  value={state.aliases}
                  disabled={state.saving || props.disabled}
                  onValueChange={(value) =>
                    setState((draft) => {
                      draft.aliases = value;
                    })
                  }
                />
              </Field>
              <Show when={invalid()}>
                <p class="agent-memory-error">{t("memory.directory.invalid")}</p>
              </Show>
              <div class="agent-memory-editor-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={state.saving || props.disabled || metadata().actor === null}
                  onClick={() => void save(true)}
                >
                  {t("memory.directory.remove")}
                </Button>
                <Button
                  size="sm"
                  disabled={props.disabled || invalid()}
                  loading={state.saving}
                  onClick={() => void save()}
                >
                  {t("memory.directory.save")}
                </Button>
              </div>
            </>
          )}
        </Show>
        <Show when={state.error}>
          {(message) => (
            <p class="agent-memory-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show when={state.phase === "failed" || state.error}>
          <Button size="sm" variant="ghost" disabled={state.saving} onClick={() => void load()}>
            {t("memory.directory.reload")}
          </Button>
        </Show>
      </section>
    </Show>
  );
}
