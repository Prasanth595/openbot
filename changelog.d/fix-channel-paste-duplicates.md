### Fixed

- Added regression coverage for image imports after repeated agent chat switches, distinct images with the same filename, later pastes, submitted attachment IDs, draft preservation, and listener cleanup. This uses synthetic renderer events; it does not verify the Windows clipboard report in #1934 or change product behavior.
