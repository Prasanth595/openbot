### Fixed

- Keep the saved account sign-in when OpenBot cannot read or save it at one start. Before, OpenBot
  deleted it, and you had to sign in with an email code again after the next restart or update.
  OpenBot now writes the reason to `logs/account/account.log` in its data folder.
