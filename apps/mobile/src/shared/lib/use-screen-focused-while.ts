import { useNavigation } from "expo-router";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the screen is focused, read only while `enabled`. A still avatar draws the same face on
 * every screen, so navigation does not render each avatar of a long list again. Disabled, it is true.
 */
export function useScreenFocusedWhile(enabled: boolean): boolean {
  const navigation = useNavigation();
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!enabled) return () => undefined;
      const removeFocus = navigation.addListener("focus", notify);
      const removeBlur = navigation.addListener("blur", notify);
      return () => {
        removeFocus();
        removeBlur();
      };
    },
    [enabled, navigation],
  );
  return useSyncExternalStore(subscribe, () => !enabled || navigation.isFocused());
}
