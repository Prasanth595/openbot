### Fixed

- A sleeping cloud server keeps its data when the hosting provider refuses its keep-alive start. Before,
  a refusal such as a billing error left the server in an error state, the keep-alive start did not
  try again, and the provider deleted the server's disk 14 days after its last stop.
