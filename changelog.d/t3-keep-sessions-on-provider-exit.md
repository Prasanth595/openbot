### Fixed

- Keep each agent's provider session when OpenBot stops through a signal, as a terminal, `systemd` or Docker sends it. The Computer Use driver stopped from the same signal and made every agent start a new provider session at the next launch, which lost the provider's own context.
