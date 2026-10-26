import { chatVisualAppTheme, chatVisualDocument } from "@openbot/contracts/chat-visual";
import * as Linking from "expo-linking";
import { type ComponentType, useMemo } from "react";
import { WebView } from "react-native-webview";
import { useUniwind } from "uniwind";
import type { HtmlPageProps } from "./html-page";

/** The margin of a page on the preview screen, as the desktop file panel gives it. */
const PAGE_MARGIN_Y = 12;
const PAGE_MARGIN_X = 16;

function openWebLink(url: string): void {
  if (/^https?:/iu.test(url)) void Linking.openURL(url);
}

/**
 * The page in a native web view, with the base styles and app theme of a desktop visual page. The
 * canvas is transparent, so a page that sets no colours shows on the app background. The view has
 * no `onMessage` and injects no script, so react-native-webview registers no message handler and
 * the page cannot call the app: do not add either. It loads from a string at `about:blank`, so it
 * cannot read app files, and `incognito` keeps its storage in memory.
 *
 * On the screen, the margin and the header space are padding of the page root: the page's own
 * background fills the space under the glass header and the home indicator.
 */
export const HtmlPage: ComponentType<HtmlPageProps> | null = function HtmlPage({
  source,
  title,
  mode,
  insets = { top: 0, bottom: 0 },
}: HtmlPageProps) {
  const { theme } = useUniwind();
  const appearance = theme === "dark" ? "dark" : "light";
  const screen = mode === "screen";
  const html = useMemo(
    () =>
      chatVisualDocument(source, {
        theme: { ...chatVisualAppTheme(appearance), "--background": "transparent" },
        appearance,
        bootstrap: false,
        ...(screen
          ? {
              style: `:root{padding:${insets.top + PAGE_MARGIN_Y}px ${PAGE_MARGIN_X}px ${insets.bottom + PAGE_MARGIN_Y}px}`,
            }
          : {}),
      }),
    [source, appearance, screen, insets.top, insets.bottom],
  );
  return (
    <WebView
      source={{ html }}
      // This handler decides every load: the default list opens any other link, of any scheme, itself.
      originWhitelist={["*"]}
      incognito
      allowsLinkPreview={false}
      contentInsetAdjustmentBehavior="never"
      scrollEnabled={screen}
      onShouldStartLoadWithRequest={(request) => {
        // The page itself, a link to a place in it, and the frames that it embeds.
        if (!request.isTopFrame || /^about:blank(?:#|$)/u.test(request.url)) return true;
        if (screen && request.navigationType === "click") openWebLink(request.url);
        return false;
      }}
      // A link with a target. WebKit blocks a window that the page opens without a tap.
      onOpenWindow={(event) => {
        if (screen) openWebLink(event.nativeEvent.targetUrl);
      }}
      accessibilityLabel={title}
      style={{ flex: 1, backgroundColor: "transparent" }}
    />
  );
};
