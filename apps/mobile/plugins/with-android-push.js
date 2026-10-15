const { withDangerousMod, assertValidAndroidAssetName } = require("expo/config-plugins");
const { copyFileSync, mkdirSync } = require("node:fs");
const { basename, join, parse, resolve } = require("node:path");

/** @type {import('expo/config-plugins').ConfigPlugin<{ sounds: string[] }>} */
module.exports = (config, { sounds }) => {
  // The Firebase app file is supplied by the build owner. Never embed the sender's private key.
  const file = process.env.OPENBOT_ANDROID_GOOGLE_SERVICES_FILE;
  if (file) config.android = { ...config.android, googleServicesFile: file };
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const directory = join(mod.modRequest.platformProjectRoot, "app/src/main/res/raw");
      mkdirSync(directory, { recursive: true });
      for (const source of sounds) {
        // Released iOS sounds contain hyphens, which Android resource names cannot contain.
        const name = basename(source).replaceAll("-", "_");
        assertValidAndroidAssetName(parse(name).name, "openbot-android-push");
        copyFileSync(resolve(mod.modRequest.projectRoot, source), join(directory, name));
      }
      return mod;
    },
  ]);
};
