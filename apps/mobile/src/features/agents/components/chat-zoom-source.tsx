import { Link } from "expo-router";
import type { PropsWithChildren } from "react";
import { useTwoPane } from "@/features/tablet/context/two-pane-context";
import { useMotionPreference } from "@/shared/lib/motion";

/**
 * The avatar that a chat zooms out of and back into on iOS. When Settings turns the zoom off, or
 * motion is reduced, the Link has no zoom source and the chat opens with the normal slide. Beside
 * the list the chat opens in the pane and never covers the row, so there is nothing to zoom from.
 */
export function ChatZoomSource({ children }: PropsWithChildren) {
  const zoom = useMotionPreference("chatZoom");
  const twoPane = useTwoPane();
  return zoom && !twoPane ? <Link.AppleZoom>{children}</Link.AppleZoom> : children;
}
