import type { NotificationApprovalAnswer } from "./notification-approvals";

/** The iOS side of the buttons of approval notifications. */
export interface NotificationActionsNative {
  /** Registers the categories with the button titles of the app language. */
  registerCategories(labels: { approve: string; deny: string }): Promise<void>;
  /**
   * Hears each button that answers an approval, also the one that started the app. Returns the function
   * that stops listening.
   */
  onAnswer(listener: (answer: NotificationApprovalAnswer) => void): () => void;
  /**
   * Asks iOS for background time, about 30 seconds, and releases the time that a start in the
   * background holds. The returned function releases it.
   */
  holdBackgroundTime(): Promise<() => void>;
  /** Tells the user that the answer did not reach the host. A tap opens the chat. */
  showFailure(answer: NotificationApprovalAnswer, body: string): Promise<void>;
}
