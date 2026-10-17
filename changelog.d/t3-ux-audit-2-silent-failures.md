### Fixed

- When a setting does not save, a message now tells you why the switch went back. When settings do
  not load, the settings page says so and has a Retry button. Before, it showed default values.
- When OpenBot cannot read your saved setup at start, it now shows Retry. Before, it opened first-run
  setup.
- 1Password, Bitwarden, Slack, Discord and Telegram now show "Unknown" and Retry when their status
  does not load. Before, they showed "Not set up". A failed "Open app" for 1Password now shows an
  error.
- Slack and Discord now have Pause, as Telegram does.
- Disconnect for an account session now asks first.
- You can undo the delete of one memory.
- Each routine in the list now has Pause or Resume. "Delete now" shows that it is in progress.
- Failed actions in the browser picture-in-picture controls, the What's New link and the routine
  webhook status now show an error.
