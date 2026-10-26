import { createContext, type PropsWithChildren, useContext } from "react";
import { Platform, useWindowDimensions } from "react-native";

import { showsTwoPane } from "@/features/tablet/model/two-pane-layout";

/** The iPad, where a window can be wide enough to hold the chat list beside the chat. */
const isTabletDevice = Platform.OS === "ios" && Platform.isPad;

const TwoPaneContext = createContext(false);

/**
 * Decides the layout once for the whole app. Every chat row reads it, so measuring the window in
 * each of them would put a listener on every row of a long list.
 */
export function TwoPaneProvider({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  return <TwoPaneContext value={showsTwoPane(width, isTabletDevice)}>{children}</TwoPaneContext>;
}

/**
 * Whether this window shows the chat list and the chat side by side. It follows the window and not
 * the device, so an iPad that moves between full screen, Split View and Slide Over changes layout
 * with it. Outside the provider, such as on the sign-in screens, it is the phone layout.
 */
export function useTwoPane(): boolean {
  return useContext(TwoPaneContext);
}
