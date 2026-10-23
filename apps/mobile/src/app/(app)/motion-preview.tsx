const preview: typeof import("@/features/agents/screens/satellite-motion-preview-screen") | null = __DEV__
  ? require("@/features/agents/screens/satellite-motion-preview-screen")
  : null;

export default preview?.SatelliteMotionPreviewScreen ?? (() => null);
