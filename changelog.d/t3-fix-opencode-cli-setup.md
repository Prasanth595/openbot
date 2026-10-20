### Changed

- OpenBot now installs OpenCode 2 (2.1.1) as its own OpenCode CLI. Your threads keep their OpenCode
  sessions.

### Fixed

- OpenCode setup no longer fails with "could not activate the managed CLI" on a computer where
  OpenCode 2 is already installed. When OpenBot uses an older OpenCode CLI that cannot open the
  database of OpenCode 2, setup now tells you to update OpenCode to version 2 or later.
- With OpenCode 2, an OpenCode thread opens again after a restart, also while OpenCode is still
  starting.
- With OpenCode 2, the model picker shows the OpenCode, OpenCode Go and custom endpoint groups by
  their names.
