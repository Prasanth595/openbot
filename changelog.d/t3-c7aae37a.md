### Fixed

- OpenCode agents no longer fail on each message with "OpenCode service failure" after OpenBot
  starts an older OpenCode than the one you installed. OpenBot now uses your installed OpenCode
  when it is newer than the copy that OpenBot downloaded. When OpenCode cannot read an agent's
  session, the agent now continues in a new session with its conversation. This includes a session
  that the downloaded copy wrote, which a newer installed OpenCode does not have. Before, each
  message to that agent failed.
