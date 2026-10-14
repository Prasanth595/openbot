import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/app";

export const messages = {
  "mobile.app.route.scanQrCode": "QRコードをスキャン",
  "mobile.app.route.createAgent": "エージェントを作成",
  "mobile.app.route.addSharedAgent": "共有エージェントを追加",
  "mobile.app.route.newSection": "新しいセクション",
  "mobile.app.route.settings": "設定",
  "mobile.app.route.profile": "プロフィール",
  "mobile.app.route.accountSessions": "アカウントのセッション",
  "mobile.app.route.about": "情報",
  "mobile.app.route.support": "サポート",
  "mobile.app.route.hiddenChats": "非表示のチャット",
  "mobile.app.route.cropPhoto": "移動と拡大縮小",
  "mobile.app.route.queuedMessages": "待機中のメッセージ",
  "mobile.app.route.messageOptions": "メッセージのオプション",
  "mobile.app.route.editMessage": "メッセージを編集",
  "mobile.app.route.serverOptions": "サーバーのオプション",
  "mobile.app.route.members": "メンバー",
  "mobile.app.route.hostedServerPlans": "クラウドサーバー",
  "mobile.app.route.hostedServerSetup": "セットアップ",
  "mobile.app.route.routines": "ルーティン",
  "mobile.app.route.routine": "ルーティン",
  "mobile.app.route.usage": "使用量",
} as const satisfies PartialTranslation<typeof source>;
