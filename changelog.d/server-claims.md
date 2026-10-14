### Added

- An operator can sign a self-hosted server or Docker container in for somebody else with no email code: `openbot login --claim <claim>`. The account service makes the one-time claim for the owner's email with the new `SERVER_CLAIMS_ADMIN_TOKEN`. The claim works once, for 15 minutes. See "Sign in with a server claim" in `docs/self-hosted-server.md`.
