### Fixed

- OpenCode agents no longer fail on each message with "OpenCode service failure" when OpenCode
  cannot read the agent's session, for example a session that another OpenCode version wrote. The
  agent now continues in a new session with its conversation.
