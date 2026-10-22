import {
  type EventFilterDraft,
  eventFilterDraft,
  eventFilterDraftsValid,
  eventFiltersFromDrafts,
} from "@openbot/contracts/event-filter-value";
import type { EventRoutine, EventRoutineOwner, RoutineWebhookTrigger } from "@openbot/contracts/ipc-events";
import { RoutineWebhookCard, type RoutineWebhookCardState } from "@openbot/ui/features/conversation/RoutineWebhookCard";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore } from "solid-js";
import type { EventRoutinesApi } from "./routine-webhooks-api";
import { agentRoutinesPort } from "./routines-port";

export type ChatWebhookRoutine = EventRoutine & { trigger: RoutineWebhookTrigger };

function isWebhookRoutine(routine: EventRoutine): routine is ChatWebhookRoutine {
  return routine.trigger.kind === "webhook";
}

/** A routine read from a store is a proxy, which the desktop bridge cannot clone. */
function plainOwner(routine: EventRoutine): EventRoutineOwner {
  return { kind: routine.owner.kind, id: routine.owner.id };
}

/**
 * The webhook routines of the chat's agent and the relay state of its host, for the cards of the
 * routines the agent created or changed. The list loads again on each routine change, because the
 * route sync stores the URL after the save. Undefined from `source` clears it.
 */
export function createChatWebhookRoutines(source: () => { api: EventRoutinesApi; agentId: string } | undefined) {
  const [state, setState] = createStore<{ routines: ChatWebhookRoutine[]; connected: boolean | null }>({
    routines: [],
    connected: null,
  });
  let request = 0;
  createEffect(source, (current) => {
    request += 1;
    setState((draft) => {
      draft.routines = [];
      draft.connected = null;
    });
    if (!current) return;
    const owner = { kind: "agent", id: current.agentId } as const;
    const load = () => {
      const loading = ++request;
      void Promise.all([current.api.listRoutines({ owner }), current.api.getStatus()])
        .then(([routines, status]) => {
          if (loading !== request) return;
          setState((draft) => {
            draft.routines = routines.filter(isWebhookRoutine);
            draft.connected = status.connected;
          });
        })
        // The plain marker stays when the host cannot list the routines.
        .catch(() => undefined);
    };
    load();
    return agentRoutinesPort(current.agentId).subscribe(load);
  });
  return state;
}

export interface RoutineWebhookChatCardProps {
  api: EventRoutinesApi;
  action: "created" | "updated";
  routine: ChatWebhookRoutine;
  connected: boolean | null;
  onOpenRoutine: (routine: { routineId: string; name: string }) => void;
}

type CardSave = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

/**
 * The chat card of a webhook routine the agent created or changed. The secret the person makes here
 * is not saved: it is gone when the card leaves the page, as in the routine settings. A change of
 * the events saves with Save, as the Save of the routine settings does.
 */
export function RoutineWebhookChatCard(props: RoutineWebhookChatCardProps) {
  const text = useText();
  const [card, setCard] = createStore<{
    secret: string | null;
    eventType: string;
    filters: EventFilterDraft[];
    edited: boolean;
    save: CardSave;
    /** The save result is newer than the routine list until the list loads again. */
    saved: ChatWebhookRoutine | null;
  }>({ secret: null, eventType: "", filters: [], edited: false, save: { status: "idle" }, saved: null });
  const routine = createMemo(() => {
    const saved = card.saved;
    return saved && saved.updatedAt > props.routine.updatedAt ? saved : props.routine;
  });
  // A list refresh must not replace an edit in progress.
  createEffect(
    () => (card.edited ? undefined : routine().trigger),
    (trigger) => {
      if (!trigger) return;
      setCard((draft) => {
        draft.eventType = trigger.eventType ?? "";
        draft.filters = trigger.filters.map(eventFilterDraft);
      });
    },
  );
  const trigger = () => ({ eventType: card.eventType.trim() || null, filters: eventFiltersFromDrafts(card.filters) });
  const changed = () => {
    const saved = routine().trigger;
    return JSON.stringify(trigger()) !== JSON.stringify({ eventType: saved.eventType, filters: saved.filters });
  };
  const valid = () => eventFilterDraftsValid(card.filters);
  const state = (): RoutineWebhookCardState => {
    if (card.save.status === "saving" || card.save.status === "error") return card.save.status;
    if (card.edited && (!valid() || changed())) return valid() ? "changed" : "error";
    return card.save.status === "saved" ? "saved" : "idle";
  };
  const errorText = () => {
    if (card.save.status === "error") return card.save.message;
    return valid() ? undefined : text.t("routine.card.webhookFiltersInvalid");
  };

  function edit(change: (draft: { eventType: string; filters: EventFilterDraft[] }) => void): void {
    setCard((draft) => {
      change(draft);
      draft.edited = true;
      if (draft.save.status !== "saving") draft.save = { status: "idle" };
    });
  }

  async function save(): Promise<void> {
    if (card.save.status === "saving" || !valid()) return;
    const current = routine();
    setCard((draft) => {
      draft.save = { status: "saving" };
    });
    try {
      const result = await props.api.saveRoutine({
        id: current.id,
        owner: plainOwner(current),
        name: current.name,
        instruction: current.instruction,
        active: current.active,
        timezone: current.timezone,
        trigger: { kind: "webhook", ...trigger() },
        ...(current.limitPolicy ? { limitPolicy: current.limitPolicy } : {}),
        ...(current.missedPolicy ? { missedPolicy: current.missedPolicy } : {}),
      });
      setCard((draft) => {
        if (isWebhookRoutine(result.routine)) draft.saved = result.routine;
        draft.edited = false;
        draft.save = { status: "saved" };
      });
    } catch (caught) {
      setCard((draft) => {
        draft.save = { status: "error", message: text.errorMessage(caught, text.t("routine.card.webhookSaveFailed")) };
      });
    }
  }

  return (
    <RoutineWebhookCard
      action={props.action}
      routineName={routine().name}
      url={routine().trigger.url}
      connected={props.connected}
      secret={card.secret}
      onSecretDismiss={() =>
        setCard((draft) => {
          draft.secret = null;
        })
      }
      onRegenerateSecret={async () => {
        const result = await props.api.rotateSecret({ owner: plainOwner(routine()), id: routine().id });
        setCard((draft) => {
          draft.secret = result.secret;
        });
      }}
      eventType={card.eventType}
      filters={card.filters}
      onEventTypeChange={(eventType) =>
        edit((draft) => {
          draft.eventType = eventType;
        })
      }
      onFiltersChange={(filters) =>
        edit((draft) => {
          draft.filters = filters;
        })
      }
      state={state()}
      errorText={errorText()}
      onSave={() => void save()}
      onOpenRoutine={() => props.onOpenRoutine({ routineId: routine().id, name: routine().name })}
    />
  );
}
