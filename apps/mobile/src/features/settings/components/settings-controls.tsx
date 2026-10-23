import { Host, Picker, Switch } from "@expo/ui";
import { labelsHidden } from "@expo/ui/swift-ui/modifiers";
import { nativeLabelFont } from "@/shared/lib/native-label-font";
import type { SettingsPickerProps, SettingsSwitchProps } from "./settings-controls.types";

export function SettingsPicker<T extends string | number>({
  value,
  options,
  enabled,
  dark,
  onChange,
}: SettingsPickerProps<T>) {
  return (
    <Host matchContents colorScheme={dark ? "dark" : "light"}>
      <Picker selectedValue={value} enabled={enabled} onValueChange={onChange}>
        {options.map((option) => (
          <Picker.Item key={option.value} label={option.label} value={option.value} />
        ))}
      </Picker>
    </Host>
  );
}

export function SettingsSwitch({
  value,
  disabled,
  label,
  hideLabel = false,
  dark,
  onValueChange,
}: SettingsSwitchProps) {
  return (
    <Host
      matchContents={hideLabel ? true : { vertical: true }}
      style={hideLabel ? undefined : { width: "100%" }}
      ignoreSafeArea={hideLabel ? "all" : undefined}
      colorScheme={dark ? "dark" : "light"}
    >
      <Switch
        value={value}
        disabled={disabled}
        label={label}
        modifiers={hideLabel ? [...nativeLabelFont, labelsHidden()] : nativeLabelFont}
        onValueChange={onValueChange}
      />
    </Host>
  );
}
