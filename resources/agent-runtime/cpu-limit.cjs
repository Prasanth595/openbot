// @ts-check
// Loaded with `--require` in NODE_OPTIONS into every Node program that an agent starts on a server
// (see AGENT_PROCESS_ENVIRONMENT in src/main/server-memory.ts). In a container or a systemd unit with
// a CPU limit, os.cpus() still lists every CPU of the host, and build tools such as Next.js start one
// worker for each: 63 workers on a 64-CPU host that gives the server 8. This makes os.cpus() list only
// as many CPUs as the process may use. It changes nothing when /proc already shows the limit (LXCFS)
// or there is no limit, and it never fails the program that loads it.
"use strict";

const { readFileSync } = require("node:fs");
const os = require("node:os");

/** The smallest CPU limit of the process's cgroup (v2) and its parents, or Infinity without one. */
function cgroupCpuLimit() {
  const line = readFileSync("/proc/self/cgroup", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("0::"));
  if (!line) return Number.POSITIVE_INFINITY;
  let limit = Number.POSITIVE_INFINITY;
  // A parent's limit applies too, so each level from the process's own cgroup to the root counts.
  for (let path = line.slice(3); ; path = path.slice(0, path.lastIndexOf("/"))) {
    try {
      const [quota, period] = readFileSync(`/sys/fs/cgroup${path}/cpu.max`, "utf8").trim().split(" ");
      if (quota !== "max" && Number(period) > 0) limit = Math.min(limit, Math.ceil(Number(quota) / Number(period)));
    } catch {
      // The root cgroup and a cgroup without the cpu controller have no cpu.max.
    }
    if (path === "" || path === "/") break;
  }
  return limit;
}

try {
  const cpus = os.cpus;
  const limit = Math.max(1, Math.min(cgroupCpuLimit(), os.availableParallelism?.() ?? Number.POSITIVE_INFINITY));
  if (limit < cpus().length) {
    os.cpus = () => cpus().slice(0, limit);
    // `import { cpus } from "node:os"` reads a copy of the exports, which this updates.
    require("node:module").syncBuiltinESMExports();
  }
} catch {
  // A missing /proc or cgroup file leaves os.cpus() as it is.
}
