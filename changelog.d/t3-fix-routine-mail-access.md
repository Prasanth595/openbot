### Changed

- An agent needs fewer steps before it uses a tool, so a run, such as a routine, sends fewer input
  tokens. A tool search now also gives the schema and guidance of its best matches.

### Fixed

- An agent now uses its browser tabs for a web service that has no tool of its own, such as mail.
  Before, a routine run in its own session could not find a tool for the service and reported that
  it had no access, although a signed-in tab was open.
- When an agent makes or changes a routine, it now writes an instruction that a run can follow
  without the chat: the service, the tool or browser tab, the account, the steps, and when to
  report. A run starts with only the newest chat messages, so an instruction such as "check the
  mail as before" did not tell it how.
