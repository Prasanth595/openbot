### Fixed

- When the signalling service closed a connection for a reason other than its rate limit, such as an expired session, the next connection waited a full minute. In the desktop app, this also kept this computer's own server away from the signalling service for that minute. Now only the closed connection waits, and only a busy signalling service makes every connection wait.
