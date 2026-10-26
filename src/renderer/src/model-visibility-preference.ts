import { createSignal } from "solid-js";
import { z } from "zod";

const HIDDEN_MODELS_STORAGE_KEY = "openbot:hidden-models";

const hiddenModelsSchema = z.array(z.string()).catch([]);

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: ReadonlySet<string> | undefined;

/**
 * The models that the model picker does not show, on this device and browser, as
 * `modelVisibilityKey` values. Reading `window.localStorage` throws when the browser blocks storage,
 * so it is read inside the guard. A value that is not a list of strings shows every model.
 */
function readHiddenModels(): ReadonlySet<string> {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return new Set(
      hiddenModelsSchema.parse(JSON.parse(window.localStorage.getItem(HIDDEN_MODELS_STORAGE_KEY) ?? "[]")),
    );
  } catch {
    return new Set();
  }
}

function writeHiddenModels(hidden: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(HIDDEN_MODELS_STORAGE_KEY, JSON.stringify([...hidden]));
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = hidden;
  }
}

const [hiddenModels, setHiddenModelsSignal] = createSignal<ReadonlySet<string>>(
  typeof window === "undefined" ? new Set() : readHiddenModels(),
);

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== HIDDEN_MODELS_STORAGE_KEY) return;
  setHiddenModelsSignal(readHiddenModels());
}

if (typeof window !== "undefined") {
  // One registration per page: addEventListener ignores the same listener twice, and HMR
  // disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

/** The shared reactive preference: a Settings change reaches every open picker at once. */
export function useHiddenModels(): () => ReadonlySet<string> {
  return hiddenModels;
}

/** Shows or hides the models with these keys, and keeps the other choices. */
export function setModelsHidden(keys: readonly string[], hide: boolean): void {
  const next = new Set(hiddenModels());
  for (const key of keys) {
    if (hide) next.add(key);
    else next.delete(key);
  }
  writeHiddenModels(next);
  setHiddenModelsSignal(next);
}
