import { ConnectedScreen } from "@/features/agents/screens/connected-screen";
import { useOnboardingGate } from "@/features/onboarding/context/onboarding-gate-context";
import { DetailPanePlaceholder } from "@/features/tablet/components/detail-pane-placeholder";
import { useTwoPane } from "@/features/tablet/context/two-pane-context";

/**
 * The home route. On a phone it is the chat list, which a chat then covers. On a tablet the list
 * keeps its own pane beside it, so the route is the detail pane the chats open in, and it holds
 * the empty state until one does. The first-run flow is the exception: it is one guided screen for
 * the whole window, so the list draws it here until it finishes.
 */
export function HomeScreen() {
  const twoPane = useTwoPane();
  const { active: onboarding } = useOnboardingGate();
  return twoPane && !onboarding ? <DetailPanePlaceholder /> : <ConnectedScreen />;
}
