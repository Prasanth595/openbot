### Added

- An agent can now mark its routine run as failed when the task could not be done, for example when
  a server it checks is down. The run history shows the run as failed, with the reason. The answer
  still shows in the chat and still goes to the routine's result destination. In a routine flow, the
  agents after a failed step are skipped.
