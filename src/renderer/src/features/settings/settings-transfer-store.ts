import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import type { InstanceTransferPreview, InstanceTransferResult, InstanceTransferSummary } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type {
  InstanceExportOptions,
  InstanceExportPhase,
  InstanceImportPhase,
  InstanceTransferScreen,
} from "@openbot/ui/features/transfer/InstanceTransferView";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore } from "solid-js";
import { transferPort } from "./transfer-port";

interface SettingsTransferState {
  screen: InstanceTransferScreen;
  summary: InstanceTransferSummary | null;
  exportPhase: InstanceExportPhase;
  exportFileName: string | null;
  exportWarnings: string[];
  exportError: string | null;
  importPhase: InstanceImportPhase;
  preview: InstanceTransferPreview | null;
  result: InstanceTransferResult | null;
  importError: string | null;
}

const INITIAL: SettingsTransferState = {
  screen: "home",
  summary: null,
  exportPhase: "options",
  exportFileName: null,
  exportWarnings: [],
  exportError: null,
  importPhase: "idle",
  preview: null,
  result: null,
  importError: null,
};

/**
 * The Transfer tab's view of one export and one import. It is created by the settings dialog, so a
 * running export or import keeps its state while another tab is open.
 */
export function createSettingsTransferStore(active: () => boolean) {
  const [state, setState] = createStore<SettingsTransferState>({ ...INITIAL });

  // The agents are read again each time the export screen opens.
  createEffect(
    () => active() && state.screen === "export" && state.exportPhase === "options",
    (load) => {
      if (!load) return;
      void transferPort()
        .instanceTransfer.summary()
        .then((summary) =>
          setState((draft) => {
            draft.summary = summary;
          }),
        )
        .catch((error: unknown) =>
          setState((draft) => {
            draft.exportError = message(error, "settings.transfer.export.failed");
          }),
        );
    },
  );

  function setScreen(screen: InstanceTransferScreen): void {
    setState((draft) => {
      draft.screen = screen;
      draft.exportError = null;
      draft.importError = null;
    });
  }

  function exportFile(options: InstanceExportOptions): void {
    setState((draft) => {
      draft.exportPhase = "exporting";
      draft.exportError = null;
    });
    void transferPort()
      .instanceTransfer.export(options)
      .then((result) =>
        setState((draft) => {
          draft.exportPhase = result.saved ? "saved" : "options";
          draft.exportFileName = result.fileName;
          draft.exportWarnings = result.warnings;
        }),
      )
      .catch((error: unknown) =>
        setState((draft) => {
          draft.exportPhase = "options";
          draft.exportError = message(error, "settings.transfer.export.failed");
        }),
      );
  }

  function showExport(): void {
    void transferPort().instanceTransfer.showExport().catch(report);
  }

  function exportAgain(): void {
    setState((draft) => {
      draft.exportPhase = "options";
      draft.exportFileName = null;
      draft.exportWarnings = [];
    });
  }

  function choose(): void {
    setState((draft) => {
      draft.importPhase = "reading";
      draft.importError = null;
    });
    void transferPort()
      .instanceTransfer.choose()
      .then((preview) =>
        setState((draft) => {
          // A closed dialog keeps the file that was open before.
          if (preview) draft.preview = preview;
          draft.importPhase = draft.preview ? "review" : "idle";
        }),
      )
      .catch((error: unknown) =>
        setState((draft) => {
          draft.importPhase = draft.preview ? "review" : "idle";
          draft.importError = message(error, "settings.transfer.import.openFailed");
        }),
      );
  }

  function importFile(keys: string[], includeSettings: boolean): void {
    const token = state.preview?.token;
    if (!token) return;
    setState((draft) => {
      draft.importPhase = "importing";
      draft.importError = null;
    });
    void transferPort()
      .instanceTransfer.apply({ token, keys, includeSettings })
      .then((result) =>
        setState((draft) => {
          draft.importPhase = "done";
          draft.preview = null;
          draft.result = result;
        }),
      )
      .catch((error: unknown) =>
        setState((draft) => {
          // The token is spent once main starts, so the file must be chosen again.
          draft.importPhase = "idle";
          draft.preview = null;
          draft.importError = message(error, "settings.transfer.import.failed");
        }),
      );
  }

  function cancelImport(): void {
    const token = state.preview?.token;
    if (token) void transferPort().instanceTransfer.discard(token).catch(report);
    setState((draft) => {
      draft.importPhase = "idle";
      draft.preview = null;
      draft.importError = null;
    });
  }

  function importDone(): void {
    setState((draft) => {
      draft.importPhase = "idle";
      draft.result = null;
      draft.screen = "home";
    });
  }

  function signIn(provider: AgentProviderId): void {
    void transferPort().connectProvider(provider).catch(report);
  }

  return {
    state,
    setScreen,
    exportFile,
    showExport,
    exportAgain,
    choose,
    importFile,
    cancelImport,
    importDone,
    signIn,
  };
}

export type SettingsTransferStore = ReturnType<typeof createSettingsTransferStore>;

function message(
  error: unknown,
  fallback:
    | "settings.transfer.export.failed"
    | "settings.transfer.import.openFailed"
    | "settings.transfer.import.failed",
): string {
  const { t, errorMessage } = currentText();
  return errorMessage(error, t(fallback));
}

function report(error: unknown): void {
  const { t, errorMessage } = currentText();
  toast.error(errorMessage(error, t("settings.transfer.import.failed")), {
    report: { operation: "settings", source: "system", cause_code: "unknown" },
  });
}
