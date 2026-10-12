### Fixed

- A connection to a remote server that stayed open for 45 minutes asked the signalling service for new relay credentials many times a second, until the service closed the socket for a minute. The service could then also close the server owner's own host connection. OpenBot now asks once every 45 minutes, and restarts the network path only when it goes through a relay.
