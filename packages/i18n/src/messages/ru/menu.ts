import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Остановить всех агентов",
  "menu.checkForUpdates": "Проверить обновления…",
  "menu.preferences": "Настройки…",
  "menu.copyLink": "Скопировать ссылку",
  "menu.trayOpen": "Открыть OpenBot",
  "menu.trayQuit": "Выйти из OpenBot",
  "menu.trayTooltip": "OpenBot",
} as const satisfies PartialTranslation<typeof source>;
