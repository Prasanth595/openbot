### Fixed

- On Windows, OpenBot now tries again when another program, such as antivirus, has a settings file
  open while OpenBot saves it. Before, a save at sign-in could fail, and then Slack, Discord and
  Telegram connections failed with "Sign in, give this computer a name, and try again."
