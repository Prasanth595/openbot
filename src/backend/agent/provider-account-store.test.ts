// @vitest-environment node

// Each account after the first keeps its credentials in a folder of its own. A mix of folders gives
// one account the credentials of another; a lost list or a lost folder loses a sign-in; and a file
// that a newer build wrote must stay as it is for that build.

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { ProviderAccountStore, type StoredProviderAccount } from "./provider-account-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function paths() {
  const root = await mkdtemp(join(tmpdir(), "openbot-provider-accounts-"));
  roots.push(root);
  return { list: join(root, "provider-accounts.json"), folders: join(root, "accounts") };
}

async function openStore(list: string, folders: string): Promise<ProviderAccountStore> {
  const store = new ProviderAccountStore(list, folders);
  await runCauseEffect(store.load());
  return store;
}

async function create(store: ProviderAccountStore, provider: "codex" | "claude"): Promise<StoredProviderAccount> {
  const account = await runCauseEffect(store.create(provider));
  if (!account) throw new Error("The provider has too many accounts.");
  return account;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe("ProviderAccountStore", () => {
  it("gives each account a private folder, and keeps the list, the names and the other folders", async () => {
    const { list, folders } = await paths();
    const store = await openStore(list, folders);
    const first = await create(store, "codex");
    const second = await create(store, "codex");
    const claude = await create(store, "claude");

    const homes = [first, second, claude].map((account) => store.home(account));
    expect(new Set(homes).size).toBe(3);
    for (const home of homes) {
      const folder = await stat(home);
      expect(folder.isDirectory()).toBe(true);
      // Windows has no POSIX modes; the folder is under the user's own profile there.
      if (process.platform !== "win32") expect(folder.mode & 0o777).toBe(0o700);
    }
    await writeFile(join(store.home(second), "auth.json"), "second account credential");

    await runCauseEffect(store.rename("codex", first.id, "Work"));
    await runCauseEffect(store.rename("codex", DEFAULT_PROVIDER_ACCOUNT_ID, "Personal"));
    await runCauseEffect(store.remove(first));

    expect(await exists(store.home(first))).toBe(false);
    expect(await readFile(join(store.home(second), "auth.json"), "utf8")).toBe("second account credential");
    expect(await exists(store.home(claude))).toBe(true);

    const reloaded = await openStore(list, folders);
    expect(reloaded.list("codex")).toEqual([second]);
    expect(reloaded.list("claude")).toEqual([claude]);
    expect(reloaded.defaultLabel("codex")).toBe("Personal");
    expect(reloaded.home(second)).toBe(store.home(second));

    await runCauseEffect(reloaded.rename("codex", second.id, "Team"));
    await runCauseEffect(reloaded.rename("codex", DEFAULT_PROVIDER_ACCOUNT_ID, null));
    const renamed = await openStore(list, folders);
    expect(renamed.get("codex", second.id)?.label).toBe("Team");
    expect(renamed.defaultLabel("codex")).toBeNull();
  });

  it("keeps a file this build cannot read unchanged and refuses every change", async () => {
    const { list, folders } = await paths();
    const newer = `${JSON.stringify({ version: 2, accounts: [{ id: "a0123456789abcdef", provider: "codex" }] })}\n`;
    await writeFile(list, newer);
    const kept = join(folders, "a0123456789abcdef");
    await mkdir(kept, { recursive: true });
    await writeFile(join(kept, "auth.json"), "newer build credential");
    const store = await openStore(list, folders);

    expect(store.list()).toEqual([]);
    await expect(runCauseEffect(store.create("codex"))).rejects.toThrow();
    await expect(runCauseEffect(store.rename("codex", DEFAULT_PROVIDER_ACCOUNT_ID, "Work"))).rejects.toThrow();
    await expect(
      runCauseEffect(store.remove({ id: "a0123456789abcdef", provider: "codex", label: null })),
    ).rejects.toThrow();

    expect(await readFile(list, "utf8")).toBe(newer);
    expect(await readFile(join(kept, "auth.json"), "utf8")).toBe("newer build credential");
  });
});
