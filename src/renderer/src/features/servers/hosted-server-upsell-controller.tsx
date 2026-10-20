import type { RoutineFields } from "@openbot/contracts/ipc";
import { HostedServerUpsellDialog } from "@openbot/ui/features/servers/HostedServerUpsellDialog";
import { HostedServerUpsellNotice } from "@openbot/ui/features/servers/HostedServerUpsellNotice";
import type { HostedUpsellHost } from "@openbot/ui/features/servers/hosted-server-upsell-host";
import { createEffect, createSignal, onCleanup, onSettled, Show, untrack } from "solid-js";
import { usePlatform } from "../../platform";
import {
  type HostedUpsellState,
  modalAllowed,
  noticeAllowed,
  readHostedUpsellState,
  withModalShown,
  withNoticeDismissed,
  withNoticePlansSeen,
  writeHostedUpsellState,
} from "./hosted-server-upsell";

type HostedUpsellEntryPoint = "routine_created" | "routines_list" | "server_offline";
type HostedUpsellAction = "shown" | "see_plans" | "dismissed";

interface HostedUpsellRoutine {
  id: string;
  name: string;
  schedule?: string | undefined;
  /** The agent whose turn made the routine. The modal waits until that turn ends. */
  agentId: string | null;
}

interface HostedServerUpsellProps {
  accountId: string | null;
  /**
   * The account can buy a hosted server and has none, and the open host is a computer, not a
   * hosted server.
   */
  canOffer: boolean;
  /** A routine that waits for the modal is dropped when the user opens another server. */
  serverId: string;
  host: HostedUpsellHost;
  busy: (agentId: string) => boolean;
  openPlans: () => void;
  track?: ((action: HostedUpsellAction, entryPoint: HostedUpsellEntryPoint) => void) | undefined;
}

interface HostedUpsellController {
  routineCreated: (routine: HostedUpsellRoutine) => void;
  canOffer: () => boolean;
  host: () => HostedUpsellHost;
  noticeVisible: () => boolean;
  dismissNotice: () => void;
  seePlans: (entryPoint: HostedUpsellEntryPoint) => void;
  track: (action: HostedUpsellAction, entryPoint: HostedUpsellEntryPoint) => void;
}

/*
 * The routine editor and the offline notice are not under the workspace overlays, so the mounted
 * offer registers itself here. Desktop and web each mount one.
 */
const [controller, setController] = createSignal<HostedUpsellController | null>(null);

/** Called when a routine is new on the open host, from the editor or from an agent. */
export function hostedUpsellRoutineCreated(routine: HostedUpsellRoutine): void {
  untrack(controller)?.routineCreated(routine);
}

/** The offer in the offline notice, or null when there is nothing to offer. */
export function hostedUpsellOffline(): { onSeePlans: () => void } | null {
  const current = controller();
  return current?.canOffer() ? { onSeePlans: () => current.seePlans("server_offline") } : null;
}

/** Recent enough to be the routine that the user or an agent just made, when no older list exists. */
const RECENT_ROUTINE_MS = 10 * 60 * 1000;

export function routineIsRecent(createdAt: string, now: number): boolean {
  return now - Date.parse(createdAt) <= RECENT_ROUTINE_MS;
}

/**
 * The active routines in `next` that are new since `previous`. With no previous list, a routine is
 * new only when it was made a short time ago, so a first load does not count old routines.
 */
export function createdRoutines(
  previous: readonly RoutineFields[] | undefined,
  next: readonly RoutineFields[],
  now: number,
): RoutineFields[] {
  const known = previous ? new Set(previous.map((routine) => routine.id)) : null;
  return next.filter(
    (routine) => routine.active && (known ? !known.has(routine.id) : routineIsRecent(routine.createdAt, now)),
  );
}

export function HostedServerUpsell(props: HostedServerUpsellProps) {
  const platform = usePlatform();
  // Each routine counts once, also when the editor and the routine list both report it.
  const reported = new Set<string>();
  const [pending, setPending] = createSignal<{ routine: HostedUpsellRoutine; serverId: string } | null>(null);
  const [openRoutine, setOpenRoutine] = createSignal<HostedUpsellRoutine | null>(null);
  const [modalThisSession, setModalThisSession] = createSignal(false);
  const [state, setState] = createSignal<HostedUpsellState | null>(null);

  createEffect(
    () => props.accountId,
    (accountId) => {
      setState(accountId ? readHostedUpsellState(window.localStorage, accountId) : null);
    },
  );
  createEffect(
    () => props.serverId,
    (serverId) => {
      setPending((current) => (current?.serverId === serverId ? current : null));
    },
  );

  function track(action: HostedUpsellAction, entryPoint: HostedUpsellEntryPoint): void {
    untrack(() => props.track)?.(action, entryPoint);
  }

  /** Saves the new state first. A failed write shows nothing, so the modal cannot repeat. */
  function showModal(routine: HostedUpsellRoutine): void {
    setPending(null);
    const accountId = untrack(() => props.accountId);
    if (!accountId) return;
    const now = Date.now();
    const saved = readHostedUpsellState(window.localStorage, accountId);
    if (!saved || !modalAllowed(saved, now)) return;
    const next = withModalShown(saved, now);
    if (!writeHostedUpsellState(window.localStorage, accountId, next)) return;
    setState(next);
    setModalThisSession(true);
    setOpenRoutine(routine);
    track("shown", "routine_created");
  }

  // The modal waits until the agent's turn ends and the window has focus, so it does not cover a reply.
  createEffect(
    () => {
      const waiting = pending();
      if (!waiting || !props.canOffer || !platform.appFocused() || modalThisSession()) return null;
      if (waiting.routine.agentId && props.busy(waiting.routine.agentId)) return null;
      return waiting.routine;
    },
    (routine) => {
      if (routine) showModal(routine);
    },
  );

  function updateState(change: (current: HostedUpsellState, now: number) => HostedUpsellState): void {
    const accountId = untrack(() => props.accountId);
    if (!accountId) return;
    const saved = readHostedUpsellState(window.localStorage, accountId);
    if (!saved) return;
    const next = change(saved, Date.now());
    writeHostedUpsellState(window.localStorage, accountId, next);
    // A failed write still hides the notice until a reload.
    setState(next);
  }

  function seePlans(entryPoint: HostedUpsellEntryPoint): void {
    if (entryPoint === "routines_list") updateState(withNoticePlansSeen);
    track("see_plans", entryPoint);
    untrack(() => props.openPlans)();
  }

  const api: HostedUpsellController = {
    routineCreated(routine) {
      if (reported.has(routine.id)) return;
      reported.add(routine.id);
      if (untrack(modalThisSession) || untrack(pending)) return;
      setPending({ routine, serverId: untrack(() => props.serverId) });
    },
    canOffer: () => props.canOffer,
    host: () => props.host,
    noticeVisible: () => {
      const saved = state();
      return props.canOffer && !modalThisSession() && saved !== null && noticeAllowed(saved, Date.now());
    },
    dismissNotice() {
      updateState(withNoticeDismissed);
      track("dismissed", "routines_list");
    },
    seePlans,
    track,
  };
  setController(api);
  onCleanup(() => setController((current) => (current === api ? null : current)));

  return (
    <Show when={openRoutine()}>
      {(routine) => (
        <HostedServerUpsellDialog
          routine={{ name: routine().name, schedule: routine().schedule }}
          host={props.host}
          onSeePlans={() => {
            setOpenRoutine(null);
            seePlans("routine_created");
          }}
          onClose={() => {
            setOpenRoutine(null);
            track("dismissed", "routine_created");
          }}
        />
      )}
    </Show>
  );
}

/** The offer at the top of a routine list, while active routines depend on this host. */
export function HostedUpsellRoutinesNotice(props: { count: number }) {
  return (
    <Show when={props.count > 0 && controller()?.noticeVisible() ? controller() : null}>
      {(upsell) => <ShownNotice upsell={upsell()} count={props.count} />}
    </Show>
  );
}

function ShownNotice(props: { upsell: HostedUpsellController; count: number }) {
  onSettled(() => props.upsell.track("shown", "routines_list"));
  return (
    <HostedServerUpsellNotice
      count={props.count}
      host={props.upsell.host()}
      onSeePlans={() => props.upsell.seePlans("routines_list")}
      onDismiss={() => props.upsell.dismissNotice()}
    />
  );
}
