### Fixed

- Keep a record when an agent delete fails. Before, a host on Windows kept no record of the step that
  failed. Now `logs/agents/agents.log` shows the step and its error code, with no file paths.
