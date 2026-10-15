### Fixed

- Do not show a "Provider error" when Codex uses its bundled bubblewrap. Before, Codex showed this error on each connect on Linux servers, but it worked.
- Install bubblewrap on Docker and hosted servers, and let the Docker seccomp profile run it. Codex agents with Workspace only access can now run commands in a Docker container. Download `docker/seccomp.json` again and recreate the container.
