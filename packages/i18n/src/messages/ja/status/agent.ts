import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "{path} に書き込みます。これはエージェントのワークスペース、共有フォルダー、一時フォルダーの外です。",
  "status.agent.contextCleared": "コンテキストを消去しました。ここから新しいチャットが始まります。",
  "status.agent.modelSwitchedForLimit": "使用量の上限に達しました。{model} に切り替えました。",
  "status.agent.modelReturnedAfterLimit": "使用量の上限が解除されました。{model} に戻しました。",
  "status.agent.marketplaceSuggested": "マーケットプレイスのアプリを提案しました: {app}。",
  "status.agent.screenCaptureScreen": "メイン画面をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.screenCaptureChannel":
    "画像はチャンネル {channel} に表示され、このサーバーでチャンネルを読むメンバー全員が見ることができます。",
  "status.agent.screenCaptureDisplay":
    "ディスプレイ {name} をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.screenCaptureWindow": "ウィンドウ {name} をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.screenCaptureRegion":
    "画面の {x}, {y}, {width} × {height} ポイントの領域をキャプチャし、その画像をエージェントのモデルに送信します。",
  "status.agent.screenCaptureProgress": "画面のキャプチャを要求しています…",
  "status.agent.screenCaptureReviewing": "画面のキャプチャを確認しています…",
} as const satisfies PartialTranslation<typeof source>;
