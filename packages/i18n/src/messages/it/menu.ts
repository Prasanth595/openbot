import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Ferma tutti gli agenti",
  "menu.checkForUpdates": "Verifica aggiornamenti…",
  "menu.preferences": "Impostazioni…",
  "menu.copyLink": "Copia link",
  "menu.trayOpen": "Apri OpenBot",
  "menu.trayQuit": "Esci da OpenBot",
  "menu.trayTooltip": "OpenBot",
} as const satisfies PartialTranslation<typeof source>;
