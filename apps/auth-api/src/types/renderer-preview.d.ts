declare module "@openbot/renderer-preview" {
  import type { JSX } from "@solidjs/web";

  export interface OpenBotPlaygroundProps {
    variant?: "default" | "landing";
  }

  export function OpenBotPlayground(props: OpenBotPlaygroundProps): JSX.Element;
}

declare module "@openbot/renderer-marketing-demo" {
  import type { JSX } from "@solidjs/web";
  export function MarketingDemo(props: { onExit?: () => void }): JSX.Element;
}
