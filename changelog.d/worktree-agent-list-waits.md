### Added

- Agents can list their open waits with `openbot.list_waits`, with each wait ID, note, open time and
  the routine that wakes it, and close a finished wait by ID. Before, an agent at the limit of 20
  open waits could not find the IDs, so it could not open new waits.
- `openbot.list_agents` shows the number of open waits of each agent. An agent can list and close
  the waits of another local agent with `agentId`.
- When an agent is close to the wait limit, a new wait tells it to close finished waits. At the
  limit, the refusal lists the open waits.
