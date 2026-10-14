import { mkdirSync, mkdtempSync, statfsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("provider-temp");

/**
 * The free space a provider process needs in its temporary folder. The Windows Antigravity server
 * is a PyInstaller one-file program: each start unpacks about 310 MB into `%TEMP%\_MEI<hex>`.
 */
const PROVIDER_TEMP_FREE_BYTES = 1024 ** 3;

export interface ProviderTempOptions {
  /** A folder OpenBot owns. Each process gets a new folder in it, removed when the process ends. */
  root: string;
  provider: string;
  availableDiskBytes?: ((path: string) => number) | undefined;
}

/**
 * Makes the temporary folder of one provider process. Only the program's own launcher removes what
 * it unpacked, and only when it ends normally: a process that is stopped or that times out left
 * each unpacked copy in the system temporary folder. OpenBot removes this folder after the process
 * closes, and the whole root at launch.
 */
export function createProviderTempDirectory(options: ProviderTempOptions): {
  env: Record<string, string>;
  dispose(): void;
} {
  mkdirSync(options.root, { recursive: true, mode: 0o700 });
  const available = (options.availableDiskBytes ?? freeDiskBytes)(options.root);
  if (available < PROVIDER_TEMP_FREE_BYTES)
    throw new Error(sourceText("error.provider.tempDiskSpace", { provider: options.provider }));
  const directory = mkdtempSync(join(options.root, "run-"));
  let disposed = false;
  return {
    // `TMP` and `TEMP` on Windows, `TMPDIR` elsewhere.
    env: { TMP: directory, TEMP: directory, TMPDIR: directory },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // Windows can hold a file of a killed process for a moment after it closes.
      rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((error: unknown) =>
        logger.warn("A provider temporary folder was not removed.", toLogValue(error)),
      );
    },
  };
}

function freeDiskBytes(path: string): number {
  const filesystem = statfsSync(path);
  return filesystem.bavail * filesystem.bsize;
}
