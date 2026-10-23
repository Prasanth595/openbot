### Changed

- A server with 5 GiB of memory or less, such as the Starter plan, now runs at most 2 turns at the same time. Other messages wait in the queue for a free slot. Before, 4 turns could start together and show a low-memory notice on a server that still had memory.
