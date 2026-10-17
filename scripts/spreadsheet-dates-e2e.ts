// bun scripts/spreadsheet-dates-e2e.ts --phase=before|after --allow-mutations --instance=<id>
// The coordinator owns the isolated seeded dev app and selects Chief before this script runs.
// Precondition: the coordinator selects English through the app UI in each fresh profile.
// Reports and panel screenshots go to .openbot-build/spreadsheet-dates-e2e/<phase>.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { developmentUserDataName, readDevelopmentInstanceId } from "../src/main/development-profile";
import { type AutomationSession, assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/spreadsheet-dates-e2e");
const SOURCE = resolve(ROOT, "packages/ui/src/features/conversation/SpreadsheetFilePreview.tsx");
const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length);
if (phase !== "before" && phase !== "after") throw new Error("Pass --phase=before or --phase=after.");
const phaseOut = resolve(OUT, phase);

interface DateCase {
  id: string;
  expected: string;
}

interface WorkbookCase {
  system: "1900" | "1904";
  cases: DateCase[];
}

// Expectations come from Excel's date systems, not the component's parser or formatters.
// https://support.microsoft.com/en-gb/excel/change-the-date-system-format-or-two-digit-year-interpretation
// https://learn.microsoft.com/en-us/troubleshoot/microsoft-365-apps/excel/wrongly-assumes-1900-is-leap-year
const workbooks: WorkbookCase[] = [
  {
    system: "1900",
    cases: [
      { id: "date-1", expected: "1900-01-01" },
      { id: "date-59", expected: "1900-02-28" },
      { id: "date-60", expected: "1900-02-29" },
      { id: "date-61", expected: "1900-03-01" },
      { id: "datetime-1.5", expected: "1900-01-01 12:00:00" },
      { id: "datetime-60.5", expected: "1900-02-29 12:00:00" },
      { id: "modern-45292", expected: "2024-01-01" },
      { id: "plain-number", expected: "60" },
      { id: "time-only", expected: "12:00:00" },
    ],
  },
  {
    system: "1904",
    cases: [
      { id: "date-0", expected: "1904-01-01" },
      { id: "date-59", expected: "1904-02-29" },
      { id: "plain-number", expected: "60" },
      { id: "time-only", expected: "12:00:00" },
    ],
  },
];

function sourceHash(): string {
  return createHash("sha256").update(readFileSync(SOURCE)).digest("hex");
}

interface CaseResult extends DateCase {
  system: WorkbookCase["system"];
  observed: string | null;
  passed: boolean;
  error: string;
}

interface Report {
  phase: "before" | "after";
  source: string;
  sourceSha256: string;
  sourceSha256After: string;
  instance: Pick<DevInstanceRecord, "instanceId" | "profile" | "rendererPort" | "remoteDebuggingPort" | "pid"> | null;
  cases: CaseResult[];
  screenshots: string[];
  errors: string[];
  passed: boolean;
}

const report: Report = {
  phase,
  source: "packages/ui/src/features/conversation/SpreadsheetFilePreview.tsx",
  sourceSha256: sourceHash(),
  sourceSha256After: "",
  instance: null,
  cases: workbooks.flatMap((workbook) =>
    workbook.cases.map((entry) => ({
      system: workbook.system,
      ...entry,
      observed: null,
      passed: false,
      error: "",
    })),
  ),
  screenshots: [],
  errors: [],
  passed: false,
};

let session: AutomationSession | undefined;
let stage = "Create artifact directory";

try {
  mkdirSync(phaseOut, { recursive: true });
  stage = "Require mutation opt-in and isolated named instance";
  const instanceId = process.argv.find((arg) => arg.startsWith("--instance="))?.slice(11);
  assertMutationAllowed({
    command: "spreadsheet-dates-e2e",
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: Boolean(instanceId),
  });
  assert.ok(instanceId && readDevelopmentInstanceId(instanceId) === instanceId, "Require an isolated instance ID.");
  stage = "Match named app registry record to this worktree";
  const named = readDevInstanceRecords().filter((entry) => entry.service === "app" && entry.instanceId === instanceId);
  assert.equal(named.length, 1, "Require exactly one named app instance.");
  const instance = named[0];
  assert.ok(instance);
  assert.equal(resolve(instance.projectRoot), ROOT, "Refuse a foreign worktree.");
  assert.equal(realpathSync(instance.projectRoot), realpathSync(ROOT));
  assert.equal(instance.profile, developmentUserDataName("app", instanceId), "Refuse a shared or mismatched profile.");
  report.instance = {
    instanceId: instance.instanceId,
    profile: instance.profile,
    rendererPort: instance.rendererPort,
    remoteDebuggingPort: instance.remoteDebuggingPort,
    pid: instance.pid,
  };
  stage = "Connect to the registered app";
  session = await connectToDevApp(instance.remoteDebuggingPort, createOpenBotLogger("spreadsheet-dates-e2e"), {
    expectedRendererPort: instance.rendererPort,
    ownerPid: instance.pid,
  });
  const page = session.page;
  page.setDefaultTimeout(10_000);
  stage = "Require selected Chief and its visible seed attachment";
  const conversation = page.getByRole("main", { name: "Conversation", exact: true });
  await conversation.getByRole("heading", { level: 1, name: "Chief", exact: true }).waitFor({ state: "visible" });
  const panel = page.getByRole("complementary", { name: "File preview", exact: true });
  assert.equal(await panel.count(), 0, "Close any existing preview before running.");
  for (const workbook of workbooks) {
    stage = `Render ${workbook.system} workbook in FilePreviewPanel`;
    const filename = `spreadsheet-dates-${workbook.system}.xlsx`;
    const open = conversation.getByRole("button", { name: `Open attached file ${filename}`, exact: true });
    await open.waitFor({ state: "visible" });
    assert.equal(await open.count(), 1, "Refuse ambiguous shared-file buttons.");
    await open.click();
    await panel.getByRole("heading", { name: filename, exact: true }).waitFor({ state: "visible" });
    const table = panel.getByRole("table", { name: `Dates ${workbook.system}`, exact: true });
    await table.waitFor({ state: "visible" });
    for (const result of report.cases.filter((entry) => entry.system === workbook.system)) {
      try {
        const row = table.getByRole("row").filter({ has: page.getByRole("cell", { name: result.id, exact: true }) });
        result.observed = await row.getByRole("cell").nth(1).innerText();
        result.passed = result.observed === result.expected;
      } catch {
        result.error = "Could not read the expected case row.";
      }
    }
    const screenshot = `${workbook.system}.png`;
    await panel.screenshot({ path: resolve(phaseOut, screenshot) });
    report.screenshots.push(screenshot);
    await panel.getByRole("button", { name: "Close file preview", exact: true }).click();
    await panel.waitFor({ state: "detached" });
  }
} catch (error) {
  // Do not export Playwright call logs, app content, profile paths or arbitrary exception text.
  report.errors.push(`${stage} failed (${error instanceof Error ? error.name : "unknown error"}).`);
} finally {
  try {
    await session?.close();
  } catch {
    report.errors.push("CDP connection cleanup failed.");
  }
  report.sourceSha256After = sourceHash();
  if (report.sourceSha256After !== report.sourceSha256)
    report.errors.push("Production source changed during this run.");
  report.passed = report.errors.length === 0 && report.cases.every((entry) => entry.passed);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(phaseOut, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
