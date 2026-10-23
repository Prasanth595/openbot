import { BrowserProfilesPanel } from "@openbot/ui/features/browser/BrowserProfilesPanel";
import { useText } from "@openbot/ui/text";
import { onSettled } from "solid-js";
import { actionToast } from "../../action-toast";
import type { BrowserProfilesStore } from "./stores/browser-profiles-store";

export interface ServerBrowserProfilesOptions {
  store: Omit<BrowserProfilesStore, "assign">;
  /** The name of an agent, for the delete question. */
  agentName: (agentId: string) => string | undefined;
}

/**
 * The Browser profiles section of the server settings. It lists the profiles again each time it
 * opens. The list also counts the agents of the shared profile, and each change lists it again,
 * because a delete moves agents.
 */
export function ServerBrowserProfilesPanel(
  props: ServerBrowserProfilesOptions & { menuMount: HTMLElement | undefined },
) {
  const { t, errorMessage } = useText();
  onSettled(() => {
    props.store
      .refresh()
      .catch((error: unknown) => actionToast.error(errorMessage(error, t("browser.profiles.loadFailed"))));
  });
  return (
    <BrowserProfilesPanel
      profiles={props.store.state.profiles}
      sharedAgentCount={props.store.state.sharedAgentIds?.length}
      agentName={props.agentName}
      onCreate={async (name) => {
        await props.store.create(name);
      }}
      onRename={props.store.rename}
      onRecolor={props.store.recolor}
      onClear={props.store.clear}
      onDelete={props.store.remove}
      menuMount={props.menuMount}
    />
  );
}
