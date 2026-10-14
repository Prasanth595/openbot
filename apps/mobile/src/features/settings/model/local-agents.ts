import { useEffect, useSyncExternalStore } from "react";
import * as LockedKeychain from "@/shared/lib/locked-keychain";
import { LocalAgentsPreference } from "./local-agents-preference";

// Notification actions can start the app while the phone is locked, so they must read this choice too.
export const localAgentsPreference = new LocalAgentsPreference({
  get: LockedKeychain.getItemAsync,
  set: (key, value) => Promise.resolve(LockedKeychain.setItem(key, value)),
});

export function useLocalAgentsPreference() {
  const state = useSyncExternalStore(localAgentsPreference.subscribe, localAgentsPreference.snapshot);
  useEffect(() => {
    void localAgentsPreference.load().catch(() => undefined);
  }, []);
  return state;
}
