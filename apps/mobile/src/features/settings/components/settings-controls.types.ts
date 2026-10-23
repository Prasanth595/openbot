interface SettingsPickerOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SettingsPickerProps<T extends string | number> {
  value: T;
  options: SettingsPickerOption<T>[];
  enabled: boolean;
  dark: boolean;
  /** The row label. Android names the menu button with it. */
  label: string;
  onChange: (value: T) => void;
}

export interface SettingsSwitchProps {
  value: boolean;
  disabled: boolean;
  label: string;
  /** Hide the visual label when its row already shows it. The switch keeps its accessible label. */
  hideLabel?: boolean;
  dark: boolean;
  onValueChange: (value: boolean) => void;
}
