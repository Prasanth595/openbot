import type { Ref } from "react";

export interface MobileSearchTextInputHandle {
  focus: () => void;
  blur: () => void;
}

export interface MobileSearchTextInputProps {
  ref?: Ref<MobileSearchTextInputHandle>;
  value: string;
  onChangeText: (value: string) => void;
  /** False while the search closes for a result, so nothing gives the field the keyboard again. */
  editable?: boolean;
}
