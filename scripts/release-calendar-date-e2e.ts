import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(import.meta.filename), "..");
const cli = join(root, "scripts/check-release-notes.ts");
const artifact = join(root, ".openbot-build/release-calendar-date-e2e.json");
const fixture = await mkdtemp(join(tmpdir(), "openbot-release-calendar-date-"));
const version = "1.2.3";

interface Result {
  mobile: boolean;
  heading: string;
  expectedExitCode: number;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  stdout: string;
  stderr: string;
  passed: boolean;
}

const results: Result[] = [];
try {
  await mkdir(join(fixture, "apps/mobile"), { recursive: true });
  await writeFile(join(fixture, "package.json"), JSON.stringify({ version }));
  await writeFile(join(fixture, "apps/mobile/app.json"), JSON.stringify({ expo: { version } }));

  const days = [
    { date: "2026-02-30", valid: false },
    { date: "2026-02-29", valid: false },
    { date: "2026-04-31", valid: false },
    { date: "1900-02-29", valid: false },
    { date: "2026-13-01", valid: false },
    { date: "2026-2-03", valid: false },
    { date: "2024-02-29", valid: true },
    { date: "2000-02-29", valid: true },
    { date: "2026-04-30", valid: true },
  ];
  for (const mobile of [false, true]) {
    const cases = days.flatMap(({ date, valid }) =>
      (mobile
        ? [
            date,
            `${date} (Android)`,
            `${date} (iOS)`,
            `${date} (Android), 2027-01-01 (iOS)`,
            `${date} (iOS), 2027-01-01 (Android)`,
            `1899-01-01 (Android), ${date} (iOS)`,
          ]
        : [date]
      ).map((dateText) => ({ dateText, valid })),
    );
    if (mobile) cases.push({ dateText: "In review", valid: true });
    for (const { dateText, valid } of cases) {
      const heading = `## [${version}] - ${dateText}`;
      const changelog = join(fixture, mobile ? "apps/mobile/CHANGELOG.md" : "CHANGELOG.md");
      await writeFile(changelog, `${heading}\n\n### Fixed\n\n- Correct release dates.\n`);
      const child = spawnSync(process.execPath, [cli, ...(mobile ? ["--mobile"] : [])], {
        cwd: fixture,
        encoding: "utf8",
      });
      const expectedExitCode = valid ? 0 : 1;
      results.push({
        mobile,
        heading,
        expectedExitCode,
        exitCode: child.status,
        signal: child.signal,
        error: child.error?.message ?? null,
        stdout: child.stdout ?? "",
        stderr: child.stderr ?? "",
        passed:
          child.status === expectedExitCode &&
          child.error === undefined &&
          child.signal === null &&
          (valid || child.stderr.includes("with a real date") || child.stderr.includes("a real YYYY-MM-DD date")),
      });
    }
  }
} finally {
  await rm(fixture, { recursive: true, force: true });
}

const passed = results.every((result) => result.passed);
await mkdir(dirname(artifact), { recursive: true });
await writeFile(artifact, `${JSON.stringify({ passed, cli, runtime: process.execPath, results }, null, 2)}\n`);
process.stdout.write(
  `${results.filter((result) => result.passed).length}/${results.length} cases passed: ${artifact}\n`,
);
if (!passed) process.exitCode = 1;
