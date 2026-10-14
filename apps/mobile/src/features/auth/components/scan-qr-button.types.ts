export interface ScanQrButtonProps {
  width: number;
  /**
   * The height of the button that the scanner opens from. HeroUI `lg` is 56 pt; without this the
   * copy keeps that height and its label sits lower than the button's.
   */
  height?: number;
  onPress: () => void;
}
