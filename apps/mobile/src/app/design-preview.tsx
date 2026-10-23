const preview: typeof import("@/features/agents/screens/team-design-preview-screen") | null = __DEV__
  ? require("@/features/agents/screens/team-design-preview-screen")
  : null;

export default preview?.TeamDesignPreviewScreen ?? (() => null);
