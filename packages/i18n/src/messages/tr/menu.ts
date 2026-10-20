import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Tüm ajanları durdur",
  "menu.checkForUpdates": "Güncellemeleri Denetle…",
  "menu.preferences": "Ayarlar…",
  "menu.copyLink": "Bağlantıyı Kopyala",
  "menu.trayOpen": "OpenBot'u aç",
  "menu.trayQuit": "OpenBot'tan çık",
  "menu.trayTooltip": "OpenBot",
} as const satisfies PartialTranslation<typeof source>;
