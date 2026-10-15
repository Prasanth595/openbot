import { createSignal, flush, Loading, lazy, onCleanup, Show } from "solid-js";
import { SERVER_VIEW_STORAGE_KEY } from "../layout-constants";
import { createDemoStorage, installDemoStorage } from "./demo-storage";

// Load the application only after its private storage has been installed. Module-level preferences
// must not read saved product data before the demo owns the window.
const MarketingDemoSession = lazy(() =>
  import("./MarketingDemoSession").then((module) => ({ default: module.MarketingDemoSession })),
);

export interface MarketingDemoProps {
  onExit?: () => void;
}

/** A full remount owns renderer state as well as the host mock. Reset does not edit saved data. */
export function MarketingDemo(props: MarketingDemoProps) {
  const storage = createDemoStorage();
  const restoreStorage = installDemoStorage(storage);
  const [generation, setGeneration] = createSignal<number | null>(1);
  let nextGeneration = 1;
  let disposed = false;
  function reset(): void {
    if (disposed) return;
    // Dispose the old renderer before its final draft write, then discard that private storage.
    flush(() => setGeneration(null));
    storage.clear();
    storage.setItem(SERVER_VIEW_STORAGE_KEY, "menu");
    setGeneration(++nextGeneration);
  }
  storage.setItem(SERVER_VIEW_STORAGE_KEY, "menu");
  onCleanup(() => {
    disposed = true;
    restoreStorage();
  });
  return (
    <div class="marketing-demo-session">
      <Loading>
        <Show keyed when={generation()}>
          {(_generation) => <MarketingDemoSession onReset={reset} onExit={props.onExit} />}
        </Show>
      </Loading>
    </div>
  );
}
