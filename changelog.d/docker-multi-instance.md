### Added

- Run several OpenBot Docker containers on one host, each with its own CPU, memory and disk limit, with `docker/instances/openbot-instance`. The containers cannot reach each other, the host or private networks, only the internet. See "Several instances on one host" in `docs/docker.md`.
