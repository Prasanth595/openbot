### Fixed

- Start OpenBot when a power loss left the joined server list or the team server settings file
  empty. Before, the start stopped with the error "Unexpected token '". The damaged file stays
  beside the new one with a `.corrupt-<time>` name. OpenBot also flushes each settings file to the
  disk before it replaces the old one, so a power loss cannot empty the file.
- Name the damaged file when a settings file stops the start. Before, the error quoted the start
  of the file and did not say which file it was.
