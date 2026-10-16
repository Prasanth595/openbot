### Security

- Make the remote connection service safer. It now closes a connection that does not sign in within
  30 seconds, and it gives the same relay credentials again when a device asks for new ones too
  frequently. Before, an idle connection stayed open for up to one day, and each request made new
  credentials.
- Stop the relay server from sending data to its own address and to more reserved network ranges.
  Before, the relay could send data to services on its own computer.
