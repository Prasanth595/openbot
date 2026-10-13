import { InstanceTransferView } from "@openbot/ui/features/transfer/InstanceTransferView";
import type { SettingsTransferStore } from "./settings-transfer-store";

/** Settings > Transfer: the shared view, driven by the dialog's transfer store. */
export function SettingsTransferTab(props: { store: SettingsTransferStore }) {
  const store = () => props.store;
  return (
    <InstanceTransferView
      screen={store().state.screen}
      onScreenChange={(screen) => store().setScreen(screen)}
      summary={store().state.summary}
      exportPhase={store().state.exportPhase}
      exportFileName={store().state.exportFileName}
      exportError={store().state.exportError}
      onExport={(options) => store().exportFile(options)}
      onShowExport={() => store().showExport()}
      onExportAgain={() => store().exportAgain()}
      importPhase={store().state.importPhase}
      preview={store().state.preview}
      result={store().state.result}
      importError={store().state.importError}
      onChoose={() => store().choose()}
      onImport={(keys, includeSettings) => store().importFile(keys, includeSettings)}
      onCancelImport={() => store().cancelImport()}
      onImportDone={() => store().importDone()}
      onSignIn={(provider) => store().signIn(provider)}
    />
  );
}
