### Added

- An instance of `docker/instances` now updates from the app, like a hosted server: Server settings › Updates and the update dialog pull the new image on the host and make the container again, with the same data. The container never gets the Docker socket: it writes an empty request file, and `openbot-instance-update@<name>.path` on the host runs the update as root. It installs only a newer version. Run `openbot-instance setup`, then `openbot-instance upgrade <name>` once, for an instance made before. See "Updates from the app" in `docs/docker.md`.
