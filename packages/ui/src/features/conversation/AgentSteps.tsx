import type { ConversationMemoryChange } from "@openbot/contracts/ipc";
import { countConversationMemoryChanges } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { Button } from "../../button";
import { Brain, ChevronDown, Puzzle, Sparkles } from "../../icons";
import { type TextValue, useText } from "../../text";

/**
 * One step of an agent's turn: a thought, a progress line of the host, or a memory change that the
 * turn committed. `memory-summary` is the count that a host without the changes sends instead.
 * The text of `progress` and `memory-summary` is the host's English source text.
 */
export type AgentStep =
  | { id: string; kind: "thinking"; text: string }
  | { id: string; kind: "progress"; text: string }
  | { id: string; kind: "memory"; change: ConversationMemoryChange }
  | { id: string; kind: "memory-summary"; text: string };

/** How tall the list grows before it scrolls, and before a live list glides to its newest step. */
const STEPS_MAX_HEIGHT = 220;

const MEMORY_ACTION_LABEL = {
  saved: "chat.steps.saved",
  updated: "chat.steps.updated",
  forgotten: "chat.steps.forgotten",
} as const;

/**
 * The steps of a turn, in order. While the turn runs, `live` marks the newest step and the list
 * glides so that step stays at the bottom edge; after the turn the list scrolls.
 */
export function AgentStepList(props: { steps: readonly AgentStep[]; live: boolean; id?: string }) {
  const { t } = useText();
  const [contentHeight, setContentHeight] = createSignal(0);
  let content: HTMLOListElement | undefined;
  onSettled(() => {
    const element = content;
    if (!element) return;
    const observer = new ResizeObserver(() => setContentHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  });
  const capped = () => contentHeight() > STEPS_MAX_HEIGHT;
  const scrolls = () => !props.live && capped();
  const offset = () => (props.live && capped() ? STEPS_MAX_HEIGHT - contentHeight() : 0);
  return (
    <section
      id={props.id}
      class="agent-steps-viewport"
      aria-label={t("chat.steps.list")}
      data-capped={capped() ? "" : undefined}
      data-scrolls={scrolls() ? "" : undefined}
      // A list that scrolls needs a keyboard stop of its own.
      tabindex={scrolls() ? 0 : undefined}
    >
      <ol ref={content} class="agent-steps-list" style={{ transform: `translateY(${offset()}px)` }}>
        <For each={props.steps} keyed={(step) => step.id}>
          {(step, index) => (
            <li class="agent-step" data-kind={step().kind}>
              <StepIcon kind={step().kind} />
              <StepBody step={step()} newest={props.live && index() === props.steps.length - 1} />
            </li>
          )}
        </For>
      </ol>
    </section>
  );
}

function StepBody(props: { step: AgentStep; newest: boolean }) {
  const text = useText();
  return <>{stepBody(props.step, props.newest, text)}</>;
}

function stepBody(step: AgentStep, newest: boolean, text: TextValue): JSX.Element {
  if (step.kind === "memory") {
    const change = step.change;
    return (
      <span class="agent-step-memory" data-action={change.action}>
        <span class="agent-step-memory-action">{text.t(MEMORY_ACTION_LABEL[change.action])}</span>
        <Show when={change.previousText}>{(previous) => <s class="agent-step-memory-previous">{previous()}</s>}</Show>
        {change.action === "forgotten" ? <s>{change.text}</s> : <span>{change.text}</span>}
      </span>
    );
  }
  const shown = step.kind === "thinking" ? step.text : text.sourceText(step.text);
  return <span class={["agent-step-text", { "agent-activity-label": newest }]}>{shown}</span>;
}

function StepIcon(props: { kind: AgentStep["kind"] }) {
  return (
    <>
      {props.kind === "thinking" ? (
        <Sparkles class="agent-step-icon" aria-hidden="true" />
      ) : props.kind === "progress" ? (
        <Puzzle class="agent-step-icon" aria-hidden="true" />
      ) : (
        <Brain class="agent-step-icon" aria-hidden="true" />
      )}
    </>
  );
}

/** The one-line summary of a finished turn's steps: "9 steps · Memory: 2 saved and 1 forgotten". */
function stepsSummary(steps: readonly AgentStep[], text: TextValue): string {
  const work = steps.filter((step) => step.kind === "thinking" || step.kind === "progress").length;
  const changes = steps.flatMap((step) => (step.kind === "memory" ? [step.change] : []));
  const counts = countConversationMemoryChanges(changes);
  const memory = text.format.list(
    [
      counts.saved ? text.t("chat.steps.memorySaved", { count: counts.saved }) : null,
      counts.updated ? text.t("chat.steps.memoryUpdated", { count: counts.updated }) : null,
      counts.forgotten ? text.t("chat.steps.memoryForgotten", { count: counts.forgotten }) : null,
    ].filter((part): part is string => part !== null),
  );
  const fallback = steps.find((step) => step.kind === "memory-summary");
  return [
    work > 0 ? text.t("chat.steps.count", { count: work }) : null,
    changes.length > 0 ? text.t("chat.steps.memory", { changes: memory }) : null,
    fallback?.kind === "memory-summary" ? text.sourceText(fallback.text) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * The steps of a finished turn, above its answer: a closed summary row that opens the list. The
 * "Show agent steps" setting opens it at first.
 */
export function AgentStepsDisclosure(props: { steps: readonly AgentStep[]; defaultOpen: boolean }) {
  const text = useText();
  const panelId = createUniqueId();
  const [choice, setChoice] = createSignal<boolean>();
  const open = () => choice() ?? props.defaultOpen;
  return (
    <div class="agent-steps" data-open={open() ? "" : undefined}>
      <Button
        type="button"
        variant="ghost"
        class="agent-steps-header"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={open() ? panelId : undefined}
        onClick={() => setChoice(!open())}
      >
        <Sparkles class="agent-steps-header-icon" aria-hidden="true" />
        <span class="agent-steps-summary">{stepsSummary(props.steps, text)}</span>
        <ChevronDown class="agent-steps-chevron" aria-hidden="true" />
      </Button>
      {/* A long chat has a row for each turn, so a closed row builds no list. */}
      <Show when={open()}>
        <div class="agent-steps-panel">
          <AgentStepList id={panelId} steps={props.steps} live={false} />
        </div>
      </Show>
    </div>
  );
}
