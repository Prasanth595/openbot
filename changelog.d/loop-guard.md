### Added

- The loop guard tells an agent when the same tool call failed 3 times in a row with the same result, so that it changes its approach. You can also make it stop the turn after a number of identical failures. See "An agent runs the same failing command again and again" in `docs/TROUBLESHOOTING.md`.

### Fixed

- A Claude tool call that returned an error now counts as failed in the turn progress text and in tool analytics. Before, every Claude tool call counted as completed.
