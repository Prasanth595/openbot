### Added

- Set the size of the virtual display that computer use reads on a self-hosted server, with
  `--display-size` at the install or `OPENBOT_DISPLAY_SIZE` in `/opt/OpenBot/hosted/openbot.env`,
  and in Docker with the `OPENBOT_DISPLAY_SIZE` variable.

### Changed

- The virtual display of a self-hosted server and of a Docker container is now 1920x1080. Before, it
  was 1280x800. Current Claude and Codex models read a full-display screenshot of this size at its
  full size. Set `OPENBOT_DISPLAY_SIZE=1280x800` to use the old size.
