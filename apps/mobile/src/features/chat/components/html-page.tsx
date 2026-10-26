import type { ComponentType } from "react";

export interface HtmlPageProps {
  source: string;
  title: string;
  /**
   * `screen` fills the preview screen, scrolls, and opens a tapped web link in the browser. `chat`
   * is part of a reply: the caller makes it take no touches.
   */
  mode: "screen" | "chat";
  /** The space that the floating header and the home indicator cover on the preview screen. */
  insets?: { top: number; bottom: number };
}

/**
 * An HTML file or a visual reply as a live page with its scripts, as desktop shows it. Only iOS has
 * one (`html-page.ios.tsx`); elsewhere this is null, and the caller shows the page with no scripts.
 * This file does not import react-native-webview: Android builds do not link its native module.
 */
export const HtmlPage: ComponentType<HtmlPageProps> | null = null;
