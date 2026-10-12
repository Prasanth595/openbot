### Fixed

- After 45 minutes on one server connection, and on each return to the app after that, the app asked the signalling service for new relay credentials many times a second, until the service closed the socket for a minute. A lost connection could not recover in that minute. The app now asks once every 45 minutes.
