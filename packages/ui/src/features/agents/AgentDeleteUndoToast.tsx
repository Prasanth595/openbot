import { Button, Progress } from "@openbot/ui";
import { createSignal, onSettled } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "./AgentAvatar";

/** How long a deleted agent can be restored. */
export const AGENT_DELETE_UNDO_MS = 8_000;
const TICK_MS = 100;

interface AgentDeleteUndoToastProps {
  agent: Pick<AgentProfile, "name" | "title" | "avatarSeed" | "avatarHue" | "avatarUrl">;
  durationMs?: number;
  onUndo: () => void;
  /** The time is over. The caller deletes the agent. */
  onExpire: () => void;
}

/**
 * The toast after an agent delete. The bar along the bottom edge shows the time left to undo.
 *
 * The toast counts its own time, so it can stop while the pointer or the keyboard focus is on it, and
 * while the window is hidden. Raise it with sonner's own timer off (`duration: Infinity`).
 */
export function AgentDeleteUndoToast(props: AgentDeleteUndoToastProps) {
  const { t } = useText();
  const duration = () => props.durationMs ?? AGENT_DELETE_UNDO_MS;
  const [remaining, setRemaining] = createSignal(duration());
  let hovered = false;
  let focused = false;

  onSettled(() => {
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - last;
      last = now;
      if (hovered || focused || document.hidden) return;
      const next = Math.max(0, remaining() - elapsed);
      setRemaining(next);
      if (next === 0) {
        window.clearInterval(timer);
        props.onExpire();
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  });

  return (
    <div
      class="agent-delete-undo-toast"
      onPointerEnter={() => {
        hovered = true;
      }}
      onPointerLeave={() => {
        hovered = false;
      }}
      onFocusIn={() => {
        focused = true;
      }}
      onFocusOut={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)))
          focused = false;
      }}
    >
      <AgentAvatar agent={props.agent} motion="idle" class="agent-delete-undo-toast-avatar" />
      <div class="agent-delete-undo-toast-text">
        <strong class="agent-delete-undo-toast-title">{t("agent.deleteUndo.title", { name: props.agent.name })}</strong>
        {props.agent.title && <span class="agent-delete-undo-toast-detail">{props.agent.title}</span>}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => props.onUndo()}>
        {t("agent.deleteUndo.action")}
      </Button>
      <Progress
        value={(remaining() / duration()) * 100}
        minValue={0}
        maxValue={100}
        class="agent-delete-undo-toast-bar"
        aria-hidden="true"
      />
    </div>
  );
}
