import type {
  AgentImportPreview,
  AgentImportResult,
  HermesImportPreview,
  OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { ArrowLeft, Button } from "@openbot/ui";
import { AgentImportSources } from "@openbot/ui/features/import/AgentImportSources";
import {
  type AgentImportPhase,
  type AgentImportSetup,
  AgentImportView,
} from "@openbot/ui/features/import/AgentImportView";
import {
  type HermesImportPhase,
  type HermesImportSelection,
  HermesImportView,
} from "@openbot/ui/features/import/HermesImportView";
import { useText } from "@openbot/ui/text";
import { createSignal, createStore, Match, onSettled, Show, Switch } from "solid-js";
import { actionToast } from "../../action-toast";

/** The way into Grok Bot this viewer chose last, so a user who set up the skill starts there. */
const SETUP_STORAGE_KEY = "openbot.agent-import.setup";

function readSetup(): AgentImportSetup {
  try {
    return window.localStorage.getItem(SETUP_STORAGE_KEY) === "skill" ? "skill" : "agent";
  } catch {
    return "agent";
  }
}

type HermesCall = "readHermes" | "chooseHermes" | "applyHermes" | "discardHermes";

export type AgentImportCalls = Omit<OpenBotDesktopApi["agentImport"], HermesCall> & {
  /** Opens the ready export agent's Grok Bot page. */
  openExportAgent(): void;
  /** The Hermes calls, on desktop only: main reads the Hermes folder of this computer. */
  hermes?: Pick<OpenBotDesktopApi["agentImport"], HermesCall>;
};

export interface ServerImportOptions {
  onOpenAgent: (agentId: string) => void;
  /** Closes the settings the panel is in. */
  onClose: () => void;
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: AgentImportCalls;
}

/** Where the agents come from. `sources` is the first screen when there is more than one. */
type ImportSource = "sources" | "grok" | "hermes";

const desktopCalls = (): AgentImportCalls => ({
  ...window.openbot.agentImport,
  openExportAgent: () => void window.openbot.openExternal("grok-bot-export"),
  hermes: window.openbot.agentImport,
});

interface ImportState {
  phase: AgentImportPhase;
  error: string | null;
  preview: AgentImportPreview | null;
  result: AgentImportResult | null;
}

interface HermesState {
  phase: HermesImportPhase;
  error: string | null;
  preview: HermesImportPreview | null;
  result: AgentImportResult | null;
}

/**
 * Server settings > Import. On desktop, main opens the file dialog and the host keeps the export
 * under a token, so the panel holds the preview and never a path. A preview left open when the panel
 * closes is released.
 */
export function ServerImportPanel(
  props: ServerImportOptions & {
    serverId: string;
    /** This computer's server: Hermes is read from a folder here. */
    hermes?: boolean;
    /** Opens the Transfer section, when the settings have one. */
    onOpenTransfer?: (() => void) | undefined;
  },
) {
  const { t, errorMessage } = useText();
  const calls = props.calls ?? desktopCalls();
  // The server the preview's token belongs to, fixed for the life of the panel.
  const serverId = props.serverId;
  const [state, setState] = createStore<ImportState>({ phase: "idle", error: null, preview: null, result: null });
  const show = (next: ImportState) =>
    setState((draft) => {
      Object.assign(draft, next);
    });

  const release = () => {
    const token = state.preview?.token;
    if (token) void calls.discard(token, serverId).catch(() => undefined);
  };
  onSettled(() => release);

  const hermesCalls = props.hermes ? calls.hermes : undefined;
  // With Grok Bot as the only source, the panel opens on its steps, as before Hermes.
  const [source, setSource] = createSignal<ImportSource>(hermesCalls || props.onOpenTransfer ? "sources" : "grok");
  const [hermes, setHermes] = createStore<HermesState>({ phase: "reading", error: null, preview: null, result: null });
  const showHermes = (next: HermesState) =>
    setHermes((draft) => {
      Object.assign(draft, next);
    });
  const releaseHermes = () => {
    const token = hermes.preview?.token;
    if (token) void hermesCalls?.discardHermes(token).catch(() => undefined);
  };
  onSettled(() => releaseHermes);

  const readHermes = async (read: () => Promise<HermesImportPreview | null>, keep: boolean) => {
    const open = hermes.preview;
    setHermes((draft) => {
      if (!open) draft.phase = "reading";
      draft.error = null;
    });
    try {
      // Null: the folder has no profiles, or the user closed the folder dialog with profiles open.
      const preview = (await read()) ?? (keep ? open : null);
      showHermes({ phase: preview ? "review" : "missing", error: null, preview, result: null });
    } catch (error) {
      showHermes({
        phase: "missing",
        error: errorMessage(error, t("server.import.readFailed")),
        preview: null,
        result: null,
      });
    }
  };

  const [updated, setUpdated] = createSignal<ReadonlySet<string>>(new Set());
  const applyHermes = async (selection: HermesImportSelection[]) => {
    const preview = hermes.preview;
    if (!preview || !hermesCalls) return;
    const keys = new Set(selection.map((entry) => entry.key));
    setUpdated(
      new Set(
        preview.profiles.flatMap((profile) => (keys.has(profile.key) && profile.agent ? [profile.agent.id] : [])),
      ),
    );
    setHermes((draft) => {
      draft.phase = "importing";
      draft.error = null;
    });
    try {
      const result = await hermesCalls.applyHermes({ token: preview.token, profiles: selection });
      showHermes({ phase: "done", error: null, preview: null, result });
    } catch (error) {
      // The token is spent either way: the profiles are read again, with the reason on top.
      const message = errorMessage(error, t("server.import.applyFailed"));
      showHermes({ phase: "reading", error: null, preview: null, result: null });
      await readHermes(() => hermesCalls.readHermes(), false);
      setHermes((draft) => {
        draft.error = message;
      });
    }
  };

  const openSource = (next: ImportSource) => {
    setSource(next);
    if (next === "hermes" && hermesCalls) void readHermes(() => hermesCalls.readHermes(), false);
  };
  const backToSources = () => {
    releaseHermes();
    showHermes({ phase: "reading", error: null, preview: null, result: null });
    reset();
    setSource("sources");
  };

  const [setup, setSetup] = createSignal(readSetup());
  const changeSetup = (next: AgentImportSetup) => {
    setSetup(next);
    try {
      window.localStorage.setItem(SETUP_STORAGE_KEY, next);
    } catch {
      // The choice is a convenience. Without storage, the panel opens on the default again.
    }
  };

  // Read once: the skill ships with the app and does not change while it runs.
  const [exportSkill, setExportSkill] = createSignal<string | null>(null);
  onSettled(() => {
    void calls
      .readSkill()
      .then(setExportSkill)
      .catch(() => setExportSkill(null));
  });

  const saveSkill = async () => {
    try {
      await calls.saveSkill();
    } catch (error) {
      actionToast.error(t("server.import.skillSaveFailed"), {
        ...{
          description: errorMessage(error, t("server.import.tryAgain")),
        },
        report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
      });
    }
  };

  const choose = async () => {
    const open = state.preview;
    setState((draft) => {
      draft.phase = "reading";
      draft.error = null;
    });
    try {
      // Null when the user cancels the dialog. Main keeps the export that was open until then.
      const preview = (await calls.choose(serverId)) ?? open;
      show({ phase: preview ? "review" : "idle", error: null, preview, result: null });
    } catch (error) {
      // A check before the host read the new export can fail with the old one still open there.
      // A released token makes the discard do nothing.
      if (open) void calls.discard(open.token, serverId).catch(() => undefined);
      show({ phase: "idle", error: errorMessage(error, t("server.import.readFailed")), preview: null, result: null });
    }
  };

  const apply = async (keys: string[], channelKeys: string[]) => {
    const preview = state.preview;
    if (!preview) return;
    setState((draft) => {
      draft.phase = "importing";
      draft.error = null;
    });
    try {
      const result = await calls.apply({ token: preview.token, keys, channelKeys }, serverId);
      show({ phase: "done", error: null, preview: null, result });
    } catch (error) {
      // The token is spent either way, so the user chooses the export again.
      show({ phase: "idle", error: errorMessage(error, t("server.import.applyFailed")), preview: null, result: null });
    }
  };

  const reset = () => {
    release();
    show({ phase: "idle", error: null, preview: null, result: null });
  };

  const grokView = () => (
    <AgentImportView
      phase={state.phase}
      error={state.error}
      preview={state.preview}
      result={state.result}
      setup={setup()}
      exportSkill={exportSkill()}
      onSetupChange={changeSetup}
      onOpenExportAgent={() => calls.openExportAgent()}
      onSaveExportSkill={() => void saveSkill()}
      onChoose={() => void choose()}
      onImport={(keys, channelKeys) => void apply(keys, channelKeys)}
      onCancel={reset}
      onDone={() => {
        reset();
        props.onClose();
      }}
      onOpenAgent={props.onOpenAgent}
    />
  );

  return (
    <Switch>
      <Match when={source() === "sources"}>
        <AgentImportSources
          hermes={Boolean(hermesCalls)}
          transfer={Boolean(props.onOpenTransfer)}
          onHermes={() => openSource("hermes")}
          onGrok={() => openSource("grok")}
          onTransfer={() => props.onOpenTransfer?.()}
        />
      </Match>
      <Match when={source() === "grok"}>
        {/* The steps have no way back of their own; a review has Cancel. */}
        <Show when={state.phase === "idle" && (hermesCalls || props.onOpenTransfer)}>
          <Button type="button" variant="ghost" size="sm" class="agent-import-back" onClick={backToSources}>
            <ArrowLeft aria-hidden="true" />
            {t("common.back")}
          </Button>
        </Show>
        {grokView()}
      </Match>
      <Match when={source() === "hermes"}>
        <HermesImportView
          phase={hermes.phase}
          preview={hermes.preview}
          result={hermes.result}
          updated={updated()}
          error={hermes.error}
          onBack={backToSources}
          onChooseFolder={() => {
            if (hermesCalls) void readHermes(() => hermesCalls.chooseHermes(), true);
          }}
          onImport={(selection) => void applyHermes(selection)}
          onDone={() => {
            backToSources();
            props.onClose();
          }}
          onOpenAgent={props.onOpenAgent}
        />
      </Match>
    </Switch>
  );
}
