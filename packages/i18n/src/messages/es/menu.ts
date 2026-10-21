import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Detener todos los agentes",
  "menu.checkForUpdates": "Buscar actualizaciones…",
  "menu.preferences": "Ajustes…",
  "menu.copyLink": "Copiar enlace",
  "menu.trayOpen": "Abrir OpenBot",
  "menu.trayQuit": "Salir de OpenBot",
  "menu.trayTooltip": "OpenBot",
} as const satisfies PartialTranslation<typeof source>;
