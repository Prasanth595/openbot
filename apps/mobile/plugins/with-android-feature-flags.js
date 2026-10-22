const { withMainApplication } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

// React Native 0.86 reads a freed shadow tree when Android looks for the next focusable view, for
// example when a text input in a scroll view gets focus. 0.87 always uses the fix behind this flag.
// `loadReactNative` sets the flags once, so replace them before React Native reads any of them.
// Remove this plugin after the upgrade to React Native 0.87.
const featureFlags = `    val reactNativeFeatureFlags: com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider =
      when (DefaultNewArchitectureEntryPoint.releaseLevel) {
        ReleaseLevel.EXPERIMENTAL ->
          com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android()
        ReleaseLevel.CANARY ->
          com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Canary_Android()
        ReleaseLevel.STABLE ->
          com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android()
      }
    com.facebook.react.internal.featureflags.ReactNativeFeatureFlags.dangerouslyForceOverride(
      object : com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider by reactNativeFeatureFlags {
        override fun fixFindShadowNodeByTagRaceCondition(): Boolean = true
      }
    )`;

/** @param {string} contents */
function addFeatureFlags(contents) {
  return mergeContents({
    src: contents,
    newSrc: featureFlags,
    tag: "openbot-react-native-feature-flags",
    anchor: /^\s*loadReactNative\(this\)$/,
    offset: 1,
    comment: "//",
  }).contents;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = (config) =>
  withMainApplication(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("The React Native feature flags require a Kotlin MainApplication.");
    }
    mod.modResults.contents = addFeatureFlags(mod.modResults.contents);
    return mod;
  });

module.exports.addFeatureFlags = addFeatureFlags;
