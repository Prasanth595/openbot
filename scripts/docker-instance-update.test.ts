import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../docker/instances/openbot-instance");
// The real functions, with Docker, systemd and the checks of the host replaced. `docker inspect`
// reads the version label from labels/<reference>, and a pull copies `next` to the image.
const harness = `
source "$SCRIPT"
HERE=$ROOT/here
DATA=$ROOT/srv
LOCKS=$ROOT
flock() { :; }
ready() { :; }
update_folders() { echo "update_folders $1" >>"$ROOT/calls"; }
docker() {
  echo "docker $*" >>"$ROOT/calls"
  case $1 in
    inspect) cat "$ROOT/labels/\${!#}" 2>/dev/null ;;
    compose)
      case " $* " in
        *" pull "*)
          if [ -e "$ROOT/fail-pull" ]; then return 1; fi
          if [ -e "$ROOT/next" ]; then cp "$ROOT/next" "$ROOT/labels/image"; fi
          ;;
        *" config "*) echo image ;;
      esac
      ;;
  esac
}
"$@"
`;

let root: string;
let requests: string;
let status: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "openbot-instance-update-"));
  requests = join(root, "srv/main/update-requests");
  status = join(root, "srv/main/update-status");
  for (const folder of ["here", "labels", requests, status]) mkdirSync(resolve(root, folder), { recursive: true });
  writeFileSync(join(root, "here/main.env"), "OPENBOT_NAME=main\n");
  writeFileSync(join(root, "labels/openbot-main"), "0.39.0\n");
  writeFileSync(join(root, "labels/image"), "0.39.0\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function request(kind: "update-stage" | "update-install", nextVersion?: string) {
  writeFileSync(join(requests, kind), "");
  if (nextVersion) writeFileSync(join(root, "next"), `${nextVersion}\n`);
  return spawnSync("bash", ["-c", harness, "harness", "update_request", "main"], {
    env: { ...process.env, ROOT: root, SCRIPT: script },
    encoding: "utf8",
  });
}

function calls(): string[] {
  return existsSync(join(root, "calls")) ? readFileSync(join(root, "calls"), "utf8").trim().split("\n") : [];
}

const recreated = () => calls().filter((call) => call.endsWith(" up --detach"));

describe("openbot-instance update-request", () => {
  it("stages a newer image and keeps the container", () => {
    const result = request("update-stage", "0.40.0");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(status, "staged.ready"), "utf8")).toBe("0.40.0\n");
    expect(existsSync(join(requests, "update-stage"))).toBe(false);
    expect(existsSync(join(status, "state"))).toBe(false);
    expect(recreated()).toEqual([]);
  });

  it("makes the container again from a newer image on an install", () => {
    const result = request("update-install", "0.40.0");

    expect(result.status, result.stderr).toBe(0);
    expect(recreated()).toHaveLength(1);
    expect(calls()).toContain("update_folders main");
    expect(existsSync(join(requests, "update-install"))).toBe(false);
    expect(existsSync(join(status, "staged.ready"))).toBe(false);
    expect(existsSync(join(status, "state"))).toBe(false);
  });

  it.each(["0.39.0", "0.38.2"])("never installs the same or an older image (%s)", (version) => {
    const result = request("update-install", version);

    expect(result.status, result.stderr).toBe(0);
    expect(recreated()).toEqual([]);
    expect(existsSync(join(status, "staged.ready"))).toBe(false);
  });

  it("installs nothing when the pull fails", () => {
    writeFileSync(join(root, "fail-pull"), "");
    const result = request("update-install", "0.40.0");

    expect(result.status).not.toBe(0);
    expect(recreated()).toEqual([]);
    expect(existsSync(join(status, "state"))).toBe(false);
  });

  it("installs nothing from an image with no release version", () => {
    const result = request("update-install", "latest");

    expect(result.status).not.toBe(0);
    expect(recreated()).toEqual([]);
    expect(existsSync(join(status, "staged.ready"))).toBe(false);
  });

  it("removes a request link or folder without following it", () => {
    const target = join(root, "host-file");
    writeFileSync(target, "keep\n");
    symlinkSync(target, join(requests, "update-stage"));
    mkdirSync(join(requests, "update-install"));
    writeFileSync(join(requests, "update-install/inner"), "");
    writeFileSync(join(root, "next"), "0.40.0\n");

    const result = spawnSync("bash", ["-c", harness, "harness", "update_request", "main"], {
      env: { ...process.env, ROOT: root, SCRIPT: script },
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(target, "utf8")).toBe("keep\n");
    expect(existsSync(join(requests, "update-stage"))).toBe(false);
    expect(existsSync(join(requests, "update-install"))).toBe(false);
  });
});
