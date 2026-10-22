import { RoutineWebhookCard } from "@openbot/ui/features/conversation/RoutineWebhookCard";
import { createEffect, createSignal, createStore } from "solid-js";
import type { EventRoutinesApi } from "./routine-webhooks-api";
import { agentRoutinesPort } from "./routines-port";

export interface ChatWebhookRoutine {
  id: string;
  name: string;
  url: string | null;
}

/**
 * The webhook routines of the chat's agent and the relay state of its host, for the cards of the
 * routines the agent created. The list loads again on each routine change, because the route sync
 * stores the URL after the save. Undefined from `source` clears it.
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
            draft.routines = routines.flatMap((routine) =>
              routine.trigger.kind === "webhook"
                ? [{ id: routine.id, name: routine.name, url: routine.trigger.url }]
                : [],
            );
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
  agentId: string;
  routine: ChatWebhookRoutine;
  connected: boolean | null;
  onOpenRoutine: (routine: { routineId: string; name: string }) => void;
}

/**
 * The chat card of a webhook routine the agent created. The secret the person makes here is not
 * saved: it is gone when the card leaves the page, as in the routine settings.
 */
export function RoutineWebhookChatCard(props: RoutineWebhookChatCardProps) {
  const [secret, setSecret] = createSignal<string | null>(null);
  return (
    <RoutineWebhookCard
      routineName={props.routine.name}
      url={props.routine.url}
      connected={props.connected}
      secret={secret()}
      onSecretDismiss={() => setSecret(null)}
      onRegenerateSecret={async () => {
        const result = await props.api.rotateSecret({
          owner: { kind: "agent", id: props.agentId },
          id: props.routine.id,
        });
        setSecret(result.secret);
      }}
      onOpenRoutine={() => props.onOpenRoutine({ routineId: props.routine.id, name: props.routine.name })}
    />
  );
}
