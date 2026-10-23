import type { PropsWithChildren } from "react";
import { View } from "react-native";
import { ClippingScrollView, type ClippingScrollViewProps } from "react-native-keyboard-controller";
import { isIOS } from "@/shared/lib/platform";

/** Keep drags in empty content, padding and insets on the native scroll view (RN #54123). */
export function ScrollTouchArea({ children }: PropsWithChildren) {
  if (!isIOS) return <View style={{ flex: 1 }}>{children}</View>;
  const props: ClippingScrollViewProps = {
    style: { flex: 1 },
    // Keep the native first-child path stable for large titles and scroll-edge effects.
    collapsable: false,
    applyWorkaroundForContentInsetHitTestBug: true,
  };
  return <ClippingScrollView {...props}>{children}</ClippingScrollView>;
}
