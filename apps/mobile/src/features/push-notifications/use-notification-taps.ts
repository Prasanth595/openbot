/**
 * The app gets notifications on iOS and Android, where `use-notification-taps.native.ts` replaces
 * this file. The tests do not load `expo-notifications`.
 */
export function useNotificationTaps(_open: (agentId: string) => void, _openChat: () => string | null): void {}
