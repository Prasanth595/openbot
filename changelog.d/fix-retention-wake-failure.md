### Fixed

- A sleeping cloud server keeps its data when the hosting provider refuses its keep-alive start or
  its start for a routine run. Before, a refusal such as a billing error left the server in an error
  state, no automatic start tried again, and the provider deleted the server's disk 14 days after its
  last stop.
