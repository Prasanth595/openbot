import type { RoutineSchedule } from "@openbot/contracts/ipc";
import type { MobileText } from "@/shared/lib/text";

/** A short cadence label. The editor keeps the full schedule for less common forms. */
export function routineScheduleSummary(schedule: RoutineSchedule, { t, format }: MobileText): string {
  const at = (label: string, time: string) => t("mobile.server.routines.scheduleAt", { schedule: label, time });
  switch (schedule.kind) {
    case "daily":
      return at(t("mobile.agent.record.schedule.daily"), schedule.time);
    case "weekdays":
      return at(t("mobile.agent.record.schedule.weekdays"), schedule.time);
    case "weekly":
      return at(
        format.date(new Date(Date.UTC(2024, 0, 7 + schedule.weekday, 12)), { weekday: "long", timeZone: "UTC" }),
        schedule.time,
      );
    case "monthly":
      return at(
        `${t("mobile.agent.record.schedule.monthly")} · ${t("mobile.agent.record.dayOfMonth")} ${format.number(schedule.day)}`,
        schedule.time,
      );
    case "hourly":
      return `${t("mobile.agent.record.schedule.hourly")} · :${format.number(schedule.minute, { minimumIntegerDigits: 2 })}`;
    case "once":
      return at(
        format.date(new Date(`${schedule.date}T12:00:00Z`), {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }),
        schedule.time,
      );
    case "advanced":
    case "interval":
    case "custom":
      return t("mobile.agent.record.schedule.custom");
  }
}
