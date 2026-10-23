import { SegmentedControl } from "@expo/ui/community/segmented-control";
import { useUniwind } from "uniwind";

/** Expo owns the native picker, accessibility, and text sizing on each platform. */
export function NativeSegmentedControl<Value extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const { theme } = useUniwind();
  return (
    <SegmentedControl
      values={options.map((option) => option.label)}
      selectedIndex={options.findIndex((option) => option.value === value)}
      appearance={theme === "dark" ? "dark" : "light"}
      style={{ width: "100%" }}
      onChange={({ nativeEvent }) => {
        const option = options[nativeEvent.selectedSegmentIndex];
        if (option) onChange(option.value);
      }}
    />
  );
}
