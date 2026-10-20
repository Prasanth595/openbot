### Fixed

- A cloud server that started again soon after it stopped sometimes stayed at "Starting Cloud
  server" with `signal/host_unavailable`. The machine continued from memory, and OpenBot did not
  start on it. The account server now starts OpenBot after such a start.
