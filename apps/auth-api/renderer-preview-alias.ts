import { fileURLToPath } from "node:url";

export const rendererPreviewAlias = fileURLToPath(
  new URL("../../src/renderer/src/preview/OpenBotPlayground.tsx", import.meta.url),
);

export const rendererWebAlias = fileURLToPath(
  new URL("../../src/renderer/src/features/web-client/WebApp.tsx", import.meta.url),
);

export const rendererMarketingDemoAlias = fileURLToPath(
  new URL("../../src/renderer/src/preview/MarketingDemo.tsx", import.meta.url),
);
