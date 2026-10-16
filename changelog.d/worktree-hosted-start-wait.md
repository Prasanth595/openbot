### Fixed

- The desktop app and the web client wait while a hosted server starts. Before, they
  stopped waiting after 5 minutes and showed "did not start in time", also when the server came online
  a minute later. They now stop only when the machine runs and OpenBot on it does not connect in 15
  minutes.
- The desktop app and the web client show the start step and its time while a hosted server starts.
  Restart is not available while the server starts.
- The desktop app shows when a hosted server did not start, could not start, or has an ended plan.
- When the cloud provider limits new starts, the account server tries the start again after a delay,
  and the desktop app and the web client say so. Before, they showed "Could not start".
