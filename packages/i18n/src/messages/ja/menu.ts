import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "すべてのエージェントを停止",
  "menu.checkForUpdates": "アップデートを確認…",
  "menu.preferences": "設定…",
  "menu.copyLink": "リンクをコピー",
  "menu.trayOpen": "OpenBot を開く",
  "menu.trayQuit": "OpenBot を終了",
  "menu.trayTooltip": "OpenBot",
} as const satisfies PartialTranslation<typeof source>;
