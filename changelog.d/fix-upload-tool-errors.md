### Fixed

- An agent now sees why a browser file upload failed, for example a selector that matches two file
  inputs or a file that does not exist, and can try again with a better target. Before, a Codex
  agent saw only "dynamic tool request failed", and OpenBot showed a "Provider error" message.
