### Fixed

- An OpenCode turn that stops sending anything now ends after 5 minutes with an error that says so. Before, the chat could show "Working on it…" for an hour, and each message you sent again waited behind it. This also applies to Cursor, Cline, Grok and custom ACP agents. A running tool call or a question that waits for you does not count.
- Stop now ends an OpenCode turn also when OpenCode does not stop it. Before, the turn could stay active after you pressed Stop.

### Changed

- OpenCode answers now appear while the model writes them, not only when the answer is complete.
- In the desktop app, the error above the message box now names the provider and model of the run that failed, so you can report it.
