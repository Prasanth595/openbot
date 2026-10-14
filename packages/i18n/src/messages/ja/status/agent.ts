import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "{path} に書き込みます。これはエージェントのワークスペース、共有フォルダー、一時フォルダーの外です。",
  "status.agent.contextCleared": "コンテキストを消去しました。ここから新しいチャットが始まります。",
  "status.agent.modelSwitchedForLimit": "使用量の上限に達しました。{model} に切り替えました。",
  "status.agent.modelReturnedAfterLimit": "使用量の上限が解除されました。{model} に戻しました。",
  "status.agent.marketplaceSuggested": "Marketplace のアプリを提案しました: {app}。",
} as const satisfies PartialTranslation<typeof source>;
