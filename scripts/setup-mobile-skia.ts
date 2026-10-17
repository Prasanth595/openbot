import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The root `postinstall` step for the mobile app. React Native Skia copies ~700 MB of prebuilt
// native libraries into its package before CocoaPods or Gradle can link them. Desktop and API work
// never reads them, so `OPENBOT_SKIP_SKIA=1` skips the copy. The default runs it, because EAS and
// local mobile builds install with no extra environment and need the libraries.
//
// On macOS, `--bun` runs the copy under Bun: its `fs.cpSync` makes APFS clones, and Node writes a
// full copy into every worktree. Where a clone is not possible, Bun writes the same files as Node.
// Linux and Windows keep the Node copy.
if (process.env.OPENBOT_SKIP_SKIA === "1") {
  process.stdout.write("Skipped the React Native Skia setup (OPENBOT_SKIP_SKIA=1).\n");
} else {
  const mobileRoot = join(dirname(dirname(fileURLToPath(import.meta.url))), "apps", "mobile");
  const runtime = process.platform === "darwin" ? ["--bun"] : [];
  const result = spawnSync(process.execPath, ["run", ...runtime, "--cwd", mobileRoot, "setup:skia"], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
}
