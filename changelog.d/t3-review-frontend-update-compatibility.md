### Fixed

- A hosted server could start with "OpenBot database failed its integrity check." after it stopped.
  The host saved the disk while OpenBot wrote its database, and kept a damaged copy. A hosted server
  now stops OpenBot and closes the database before the host saves the disk. A server gets this
  change when it updates and starts again.
- A server that got the stop signal (for example, from `systemctl stop` or `docker stop`) ended at
  once. It now stops its services and closes the database, as the desktop app does when it quits.
- The integrity check error is now in your language, and the log shows which parts of the database
  are damaged.
