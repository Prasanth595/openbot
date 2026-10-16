### Fixed

- Gemini connects on Windows when its server takes longer than 30 s to start. After a sign-in, a
  key change, or a start that did not finish in time, OpenBot waits up to 3 minutes for the next
  start. Before, OpenBot stopped the server while it unpacked, and each try failed with "ACP
  initialization timed out." The error now says which step did not finish: the start or the model
  list. The log records when each provider process starts, first answers, and ends.
