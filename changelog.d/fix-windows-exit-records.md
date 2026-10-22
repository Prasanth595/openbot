### Fixed

- On Windows and Linux, Ctrl+W in the main window no longer closes OpenBot when no browser tab is
  open. With "Keep OpenBot running in the background" off, it quit the app with no question.

### Added

- When OpenBot closes by itself, it now leaves a local record of the reason: a `Quitting` line in
  `logs/main/main.log`, an `exit` line and immediate process exit lines in `logs/trace.ndjson`, and
  a crash dump in the `Crashpad` folder when a process crashes. Nothing is uploaded. Do not attach a
  crash dump publicly: it can hold secrets.
