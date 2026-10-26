### Fixed

- On Windows, Claude starts when the Claude Code CLI comes from npm (`claude.cmd`). Before, every Claude session, model list and usage read failed with "spawn EINVAL", and sign-in and sign-out through such a CLI failed too. Stopping a session now also stops the Claude process that the `.cmd` file started.
