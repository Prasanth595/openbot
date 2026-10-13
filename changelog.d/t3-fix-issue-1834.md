### Fixed

- A routine run that a local script or a webhook starts can now end quietly, as a scheduled run does.
  Before, OpenBot sent it as a Test run, so the agent always wrote a report. The run history now
  shows "Script" or "Webhook" for these runs, not "Manual".

### Changed

- The chat now keeps the answer of a quiet routine run. Each routine run row opens and closes the
  messages of its run. A quiet run that has finished starts closed, a run that reported something
  starts open, and a run that is in progress stays open until it finishes. A quiet answer does not
  count as unread and does not change the chat preview.
