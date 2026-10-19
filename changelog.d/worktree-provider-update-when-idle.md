### Fixed

- Update a provider CLI while the provider works on a turn. Before, Update and Retry showed
  "Update failed" with "The Claude CLI is working on a turn. Wait for it to finish, then update.",
  and you had to press Retry again later. Now the provider row shows "Waiting" and the update
  starts by itself when the current turn ends. New turns of that provider wait for the update.
  Cancel stops the wait.
