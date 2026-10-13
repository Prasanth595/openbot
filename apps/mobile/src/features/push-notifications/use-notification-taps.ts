/**
 * The app gets notifications only on iOS, where `use-notification-taps.ios.ts` replaces this file.
 * Other platforms and the tests do not load `expo-notifications`.
 */
export function useNotificationTaps(_open: (agentId: string) => void, _openChat: () => string | null): void {}
