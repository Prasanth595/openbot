// Instance transfer for this computer. Main opens both file dialogs, so the renderer never names a
// path, and only main can reveal the saved file.

import { join } from "node:path";
import { parseApplyInstanceTransferInput, parseExportInstanceInput } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { app, type BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions, shell } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { InstanceTransferService } from "../instance-transfer-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface InstanceTransferIpcDependencies {
  instanceTransfer: InstanceTransferService;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function instanceTransferIpcHandlers({
  instanceTransfer,
  getMainWindow,
  translate,
}: InstanceTransferIpcDependencies): Pick<IpcGroupHandlers, "instanceTransfer"> {
  const filters = [{ name: translate("dialog.filter.transfer"), extensions: ["zip"] }];

  const chooseDestination = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const date = new Date().toISOString().slice(0, 10);
    const options: SaveDialogOptions = {
      title: translate("dialog.saveTransfer"),
      defaultPath: join(app.getPath("downloads"), `openbot-transfer-${date}.zip`),
      filters,
      showsTagField: false,
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  };

  const chooseFile = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const options: OpenDialogOptions = {
      title: translate("dialog.chooseTransfer"),
      properties: ["openFile"],
      filters,
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };

  return {
    instanceTransfer: {
      summary: handler(() => runCauseEffect(instanceTransfer.summary())),
      export: payloadHandler(parseExportInstanceInput, async (input) => {
        const path = await chooseDestination();
        if (!path) return { saved: false, fileName: null, warnings: [] };
        return runCauseEffect(instanceTransfer.exportTo(path, input));
      }),
      showExport: handler(() => {
        const path = instanceTransfer.lastExport();
        if (path) shell.showItemInFolder(path);
      }),
      choose: handler(async () => {
        const path = await chooseFile();
        return path ? runCauseEffect(instanceTransfer.stage(path)) : null;
      }),
      apply: payloadHandler(parseApplyInstanceTransferInput, (input) => runCauseEffect(instanceTransfer.apply(input))),
      discard: payloadHandler(stringPayload("token"), (token) => instanceTransfer.discard(token)),
    },
  };
}
