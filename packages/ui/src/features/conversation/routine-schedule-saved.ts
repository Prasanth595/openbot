import type { RoutineSchedule } from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { routineOnceInstant } from "@openbot/team-client/routine-schedule";
import {
  type RoutineDraftProblem,
  type RoutineScheduleDraft,
  routineDraftProblemCode,
} from "@openbot/team-client/routine-schedule-draft";
import { currentText } from "../../text";
import { ROUTINE_DRAFT_KINDS } from "./routine-schedule-draft";

// The conversion between a draft and a saved schedule is shared with the phone.
export { routineScheduleFromDraft, routineScheduleToDraft } from "@openbot/team-client/routine-schedule-draft";

/**
 * The kinds every host saves. Only this computer's host saves `once`: the released Team API
 * cannot carry it.
 */
export const ROUTINE_SAVED_DRAFT_KINDS = ROUTINE_DRAFT_KINDS.filter((option) => option.value !== "once");

/** The kinds this computer's host saves. */
export const ROUTINE_LOCAL_DRAFT_KINDS = ROUTINE_DRAFT_KINDS;

const PROBLEM_TEXT = {
  endBeforeStart: "routine.problem.endBeforeStart",
  invalidDate: "routine.problem.invalidDate",
  cronRequired: "routine.problem.cronRequired",
  cronTooLong: "routine.problem.cronTooLong",
} as const satisfies Record<RoutineDraftProblem, AppTextKey>;

/** Why the draft cannot be saved, or `null`. A save of such a draft would change when it runs. */
export function routineDraftProblem(draft: RoutineScheduleDraft, t: AppTranslate = currentText().t): string | null {
  const problem = routineDraftProblemCode(draft);
  return problem ? t(PROBLEM_TEXT[problem]) : null;
}

/**
 * A one-time routine whose time has passed: the host paused it after its run, or after it recorded
 * the run as missed. It cannot resume until its date moves to the future.
 */
export function routineOnceCompleted(
  routine: { active: boolean; timezone: string; schedule: RoutineSchedule },
  now = new Date(),
): boolean {
  if (routine.active || routine.schedule.kind !== "once") return false;
  return routineOnceInstant(routine.schedule, routine.timezone).getTime() <= now.getTime();
}
