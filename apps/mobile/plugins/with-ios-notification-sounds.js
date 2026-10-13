const { withXcodeProject } = require("expo/config-plugins");
const { setNotificationSounds } = require("expo-notifications/plugin/build/withNotificationsIOS");

// Adds the notification sounds to the iOS app only. The `expo-notifications` plugin also copies its
// `sounds` into the Android resources, which reject the `-` in the names. The names stay, because the
// account service sends them to released iPhone builds (`NOTIFICATION_SOUND_FILES`), and the app gets
// notifications only on iOS.

/** @type {import('expo/config-plugins').ConfigPlugin<{ sounds: string[] }>} */
module.exports = (config, { sounds }) =>
  withXcodeProject(config, (config) => {
    config.modResults = setNotificationSounds(config.modRequest.projectRoot, {
      sounds,
      project: config.modResults,
      projectName: config.modRequest.projectName,
    });
    return config;
  });
