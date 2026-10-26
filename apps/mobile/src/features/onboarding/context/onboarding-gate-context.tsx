import { createContext, type PropsWithChildren, useContext } from "react";

import { type OnboardingGate, useOnboardingGateState } from "@/features/onboarding/model/use-onboarding-gate";

const OnboardingGateContext = createContext<OnboardingGate | null>(null);

/**
 * Holds the first-run decision for the whole authenticated app. On a tablet the home screen is two
 * screens at once, the chat list and the detail pane, and the flow belongs to neither: it takes the
 * window. One holder keeps the two in step, and finishing the flow ends it in both.
 */
export function OnboardingGateProvider({ children }: PropsWithChildren) {
  const gate = useOnboardingGateState();
  return <OnboardingGateContext value={gate}>{children}</OnboardingGateContext>;
}

export function useOnboardingGate(): OnboardingGate {
  const gate = useContext(OnboardingGateContext);
  if (!gate) throw new Error("useOnboardingGate must be used within OnboardingGateProvider.");
  return gate;
}
