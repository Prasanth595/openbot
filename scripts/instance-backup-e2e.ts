// End-to-end check of `openbot-instance backup`, `verify`, `restore` and `backups`
// (docs/docker.md#backups). It runs the real script as root in a privileged Docker-in-Docker
// container, with a loop-mounted ext4 data disk, as on a host of `docker/instances`. The instance is
// a small stand-in container with the release label of an OpenBot image, not the OpenBot image: the
// check is of the script, its archive and its failure paths. The data has an `openbot.db` of the
// latest schema and a shared tables database, which the verification opens with sqlite3.
//
//   bun scripts/instance-backup-e2e.ts
//
// It needs Docker and network access for the images and the Alpine packages. The report is
// `.openbot-build/instance-backup-e2e/report.json`.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateOpenBotDatabase } from "../src/backend/openbot-database-schema";

const reportRoot = resolve(".openbot-build/instance-backup-e2e");
const dind = `openbot-backup-e2e-${randomBytes(4).toString("hex")}`;
const script = "/opt/openbot-docker/instances/openbot-instance";
const data = "/srv/openbot/main/data";
const agentId = "agent-e2e-1";
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], input?: string): Run {
  const result = spawnSync(command, args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** A shell command as root in the Docker-in-Docker container. */
function shell(command: string): Run {
  return run("docker", ["exec", "--interactive", dind, "bash", "-euo", "pipefail", "-c", command]);
}

function must(command: string): string {
  const result = shell(command);
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr}${result.stdout}`);
  return result.stdout.trim();
}

function instance(...args: string[]): Run {
  return shell([script, ...args].map((arg) => `'${arg}'`).join(" "));
}

function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "pass" : "FAIL"} ${name}: ${detail}\n`);
}

function running(): boolean {
  return shell("docker inspect --format '{{.State.Running}}' openbot-main").stdout.trim() === "true";
}

function completeBackups(): string[] {
  const out = shell('for f in /backups/main/*Z; do [ -f "$f/manifest.json" ] && basename "$f"; done; true').stdout;
  return out.split("\n").filter(Boolean);
}

function summary(result: Run): string {
  return `exit ${result.status}: ${(result.stderr || result.stdout).trim().split("\n").slice(-4).join(" | ")}`;
}

/** The data of one instance: the database, shared tables, keyring, a workspace and an attachment. */
async function writeFixture(root: string): Promise<void> {
  const config = join(root, ".config/OpenBot");
  const shared = join(root, "OpenBot/Shared/Data");
  await mkdir(config, { recursive: true });
  await mkdir(shared, { recursive: true });
  await mkdir(join(root, ".local/share/keyrings"), { recursive: true });
  await mkdir(join(root, ".config/openbot-container"), { recursive: true });
  await mkdir(join(root, "OpenBot/Agents/E2E"), { recursive: true });

  const db = new DatabaseSync(join(config, "openbot.db"));
  migrateOpenBotDatabase(db);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO projection_agents (agent_id, thread_id, model, updated_at, sort_order, agent_json, last_event_sequence) VALUES (?, ?, 'test', ?, 0, ?, 1)",
  ).run(agentId, "thread-e2e-1", now, JSON.stringify({ id: agentId, name: "E2E" }));
  db.prepare(
    "INSERT INTO projection_threads (thread_id, agent_id, title, created_at, updated_at, last_event_sequence) VALUES ('thread-e2e-1', ?, 'E2E', ?, ?, 1)",
  ).run(agentId, now, now);
  db.prepare(
    "INSERT INTO projection_thread_messages (thread_id, message_id, author, status, created_at, ordinal, message_json, last_event_sequence) VALUES ('thread-e2e-1', 'message-1', 'user', 'complete', ?, 0, '{}', 1)",
  ).run(now);
  db.prepare(
    "INSERT INTO projection_agent_memories (memory_id, agent_id, text, normalized_text, origin, created_at, updated_at, last_event_sequence) VALUES ('memory-1', ?, 'The user likes tea.', 'the user likes tea.', 'manual', ?, ?, 1)",
  ).run(agentId, now, now);
  db.close();

  const tables = new DatabaseSync(join(shared, "agent-data.db"));
  tables.exec(
    "CREATE TABLE openbot_metadata (table_name TEXT PRIMARY KEY, owner_agent_id TEXT NOT NULL, created_at TEXT NOT NULL)",
  );
  tables.exec("CREATE TABLE contacts (name TEXT, email TEXT)");
  tables.exec("INSERT INTO contacts VALUES ('Ada', 'ada@example.com')");
  tables.exec("CREATE TABLE tasks (title TEXT)");
  tables.prepare("INSERT INTO openbot_metadata VALUES ('contacts', ?, ?)").run(agentId, now);
  // An owner that is not an agent: verification reports it as a warning.
  tables.prepare("INSERT INTO openbot_metadata VALUES ('tasks', 'agent-removed', ?)").run(now);
  tables.close();

  await writeFile(join(root, ".local/share/keyrings/login.keyring"), randomBytes(512));
  await writeFile(join(root, ".config/openbot-container/keyring-password"), randomBytes(32).toString("hex"), {
    mode: 0o600,
  });
  await writeFile(join(root, "OpenBot/Agents/E2E/notes.md"), "Saved before the backup.\n");
  await writeFile(join(root, "OpenBot/Agents/E2E/attachment.bin"), randomBytes(256 * 1024));
}

// The stand-in for the OpenBot image: it has the release label, runs as UID 1000, and writes a file
// when it gets the stop signal, as OpenBot closes its database.
const standIn = `FROM alpine:3.22
LABEL org.opencontainers.image.version=0.40.0
RUN printf '#!/bin/sh\\ntrap "date > /data/.e2e-clean-stop; exit 0" TERM\\ndate >> /data/.e2e-starts\\nwhile true; do sleep 1 & wait $!; done\\n' >/app && chmod 0755 /app
USER 1000:1000
ENTRYPOINT ["/app"]
`;

async function main(): Promise<void> {
  await mkdir(reportRoot, { recursive: true });
  const fixture = await mkdtemp(join(reportRoot, "fixture-"));
  try {
    await writeFixture(fixture);
    const started = run("docker", ["run", "--detach", "--privileged", "--name", dind, "docker:28-dind"]);
    if (started.status !== 0) throw new Error(`Docker-in-Docker did not start: ${started.stderr}`);
    // The daemon in the container is ready when `docker info` answers.
    // Alpine has no bash before the packages are installed.
    const ready = run("docker", [
      "exec",
      dind,
      "sh",
      "-c",
      "for i in $(seq 120); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1",
    ]);
    if (ready.status !== 0) throw new Error("The Docker daemon in the container did not start.");
    const packages = run("docker", [
      "exec",
      dind,
      "apk",
      "add",
      "--quiet",
      "bash",
      "coreutils",
      "util-linux",
      "findutils",
      "sqlite",
      "zstd",
      "tar",
      "e2fsprogs",
      "gzip",
    ]);
    if (packages.status !== 0) throw new Error(`The packages did not install: ${packages.stderr}`);
    run("docker", ["cp", resolve("docker"), `${dind}:/opt/openbot-docker`]);
    run("docker", ["cp", `${fixture}/.`, `${dind}:/fixture`]);
    must(`mkdir -p /stand-in && cat >/stand-in/Dockerfile <<'EOF'\n${standIn}EOF`);
    must("docker build --quiet --tag ghcr.io/nightly-labs/openbot:latest /stand-in >/dev/null");

    // The layout of `openbot-instance create`, without systemd: an ext4 image mounted as /data.
    must(`mkdir -p /srv/openbot/main/data /backups
      fallocate --length 256M /srv/openbot/main/data.img
      mkfs.ext4 -q -m 0 /srv/openbot/main/data.img
      mount -o loop /srv/openbot/main/data.img ${data}
      cp -a /fixture/. ${data}/ && chown -R 1000:1000 ${data} && chmod 0700 ${data}
      printf 'OPENBOT_NAME=main\\nOPENBOT_CPUS=1\\nOPENBOT_MEM=1g\\nOPENBOT_DISK=256M\\nOPENBOT_BACKUP_DIR=/backups\\nOPENBOT_BACKUP_KEEP=2\\nOPENBOT_BACKUP_MAX_AGE=24\\n' >/opt/openbot-docker/instances/main.env
      docker run --detach --name openbot-main --stop-timeout 20 -v ${data}:/data ghcr.io/nightly-labs/openbot:latest >/dev/null`);
    const dataHash = must(`sha256sum ${data}/.config/OpenBot/openbot.db | cut -d ' ' -f 1`);

    let result = instance("backups", "main");
    check(
      "status before the first backup is overdue",
      result.status === 1 && /older than 24 hours/.test(result.stdout),
      summary(result),
    );

    result = instance("backup", "main", "--verify");
    const first = completeBackups()[0] ?? "";
    check("backup and verify", result.status === 0 && first !== "", summary(result));
    check("instance runs again after the backup", running(), `running=${running()}`);
    check("clean stop before the copy", shell(`test -f ${data}/.e2e-clean-stop`).status === 0, "stop file written");
    const manifest = JSON.parse(must(`cat /backups/main/${first}/manifest.json`));
    check(
      "manifest has the version, checksum and downtime",
      manifest.openbotVersion === "0.40.0" &&
        /^[0-9a-f]{64}$/.test(manifest.archiveSha256) &&
        manifest.wasRunning === true,
      JSON.stringify({
        version: manifest.openbotVersion,
        archive: manifest.archive,
        downtime: manifest.downtimeSeconds,
      }),
    );
    const verified = JSON.parse(must(`cat /backups/main/${first}/verified.json`));
    check(
      "verification counts the saved data",
      verified.agents === 1 &&
        verified.threads === 1 &&
        verified.messages === 1 &&
        verified.memories === 1 &&
        verified.sharedTables === 2,
      JSON.stringify(verified),
    );
    check(
      "verification reports a shared table owner that is not an agent",
      verified.warnings.some((warning: string) => warning.includes("1 shared table owners")),
      JSON.stringify(verified.warnings),
    );
    check(
      "the backup folder is private",
      must(`stat --format=%a /backups/main /backups/main/${first}`) === "700\n700",
      must("stat --format=%a /backups/main"),
    );

    result = instance("backups", "main", "--json");
    const status = JSON.parse(result.stdout);
    check(
      "status after a backup",
      result.status === 0 &&
        status.overdue === false &&
        status["backup-success"]?.result === "ok" &&
        status["verify-success"]?.result === "ok",
      summary(result),
    );

    // Missing key material: the backup fails, the instance runs again, the earlier backup stays.
    must(`mv ${data}/.config/openbot-container/keyring-password /root/keyring-password`);
    result = instance("backup", "main");
    must(`mv /root/keyring-password ${data}/.config/openbot-container/keyring-password`);
    check(
      "a backup without the keyring password fails",
      result.status !== 0 && /keyring-password is missing/.test(result.stderr) && completeBackups().length === 1,
      summary(result),
    );
    check("instance runs after a failed backup", running(), `running=${running()}`);
    result = instance("backups", "main");
    check(
      "status shows the failed backup",
      result.status === 1 && /Last backup: failed/.test(result.stdout),
      result.stdout.trim(),
    );

    // A full destination: the backup fails before it stops the instance.
    must("mkdir -p /small && mount -t tmpfs -o size=64k tmpfs /small");
    must("sed -i 's#^OPENBOT_BACKUP_DIR=.*#OPENBOT_BACKUP_DIR=/small#' /opt/openbot-docker/instances/main.env");
    const startsBefore = must(`wc -l < ${data}/.e2e-starts`);
    result = instance("backup", "main");
    must("sed -i 's#^OPENBOT_BACKUP_DIR=.*#OPENBOT_BACKUP_DIR=/backups#' /opt/openbot-docker/instances/main.env");
    check(
      "a backup to a full disk fails without a stop",
      result.status !== 0 &&
        /free/.test(result.stderr) &&
        must(`wc -l < ${data}/.e2e-starts`) === startsBefore &&
        running(),
      summary(result),
    );
    check(
      "no partial backup stays",
      must("find /small /backups -name '*.partial' | wc -l") === "0",
      "no .partial folder",
    );

    // A damaged archive: verification fails.
    must(
      `cp -a /backups/main/${first} /backups/main/damaged && printf 'x' | dd of=/backups/main/damaged/${manifest.archive} bs=1 seek=100 conv=notrunc 2>/dev/null`,
    );
    result = instance("verify", "main", "damaged");
    must("rm -rf /backups/main/damaged");
    check(
      "a damaged archive fails verification",
      result.status !== 0 && /checksums/.test(result.stderr),
      summary(result),
    );
    check(
      "verification removes its temporary folder",
      must("find /var/tmp -maxdepth 1 -name 'openbot-verify.*' | wc -l") === "0",
      "no openbot-verify folder in /var/tmp",
    );

    // Retention: with OPENBOT_BACKUP_KEEP=2, the third backup removes the first.
    instance("backup", "main");
    result = instance("backup", "main");
    const kept = completeBackups();
    check(
      "retention keeps 2 backups",
      result.status === 0 && kept.length === 2 && !kept.includes(first),
      kept.join(", "),
    );
    const latest = kept.at(-1) ?? "";

    // Restore: the data changes after the backup, and the restore gives back the backup.
    must(`echo changed > ${data}/OpenBot/Agents/E2E/after-backup.md && rm ${data}/OpenBot/Agents/E2E/notes.md`);
    result = instance("restore", "main", latest);
    check(
      "restore without --replace refuses data",
      result.status !== 0 && /--replace/.test(result.stderr) && running(),
      summary(result),
    );

    must(
      `cp -a /backups/main/${latest} /backups/main/newer && sed -i 's/"openbotVersion": "0.40.0"/"openbotVersion": "99.0.0"/' /backups/main/newer/manifest.json`,
    );
    result = instance("restore", "main", "newer", "--replace");
    must("rm -rf /backups/main/newer");
    check(
      "restore refuses a backup from a newer OpenBot",
      result.status !== 0 && /99\.0\.0/.test(result.stderr) && running(),
      summary(result),
    );

    result = instance("restore", "main", latest, "--replace");
    check("restore with --replace", result.status === 0, summary(result));
    check("instance stays stopped after a restore", !running(), `running=${running()}`);
    const restored = must(
      `cd ${data} && test -f OpenBot/Agents/E2E/notes.md && test ! -e OpenBot/Agents/E2E/after-backup.md && test ! -e .openbot-restore && test ! -e .openbot-replaced && sha256sum .config/OpenBot/openbot.db | cut -d ' ' -f 1`,
    );
    check("restored data is the backup", restored === dataHash, `openbot.db ${restored.slice(0, 12)}`);
    check(
      "restored files belong to the user of the data",
      must(`find ${data} -mindepth 1 ! -user 1000 ! -path '${data}/lost+found*' | wc -l`) === "0",
      "owner 1000",
    );
    must("docker start openbot-main >/dev/null");
    check("instance starts on the restored data", running(), `running=${running()}`);
  } finally {
    run("docker", ["rm", "--force", "--volumes", dind]);
    await rm(fixture, { recursive: true, force: true });
    const failed = results.filter((result) => !result.ok);
    await writeFile(
      join(reportRoot, "report.json"),
      `${JSON.stringify({ finishedAt: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2)}\n`,
    );
    process.stdout.write(
      `${results.length - failed.length}/${results.length} passed. Report: ${join(reportRoot, "report.json")}\n`,
    );
    if (failed.length > 0 || results.length === 0) process.exitCode = 1;
  }
}

await main();
