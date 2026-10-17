### Fixed

- Stop the new provider process when OpenBot quits while it changes a provider key, updates a provider CLI or reconnects a provider. Before, that process could continue to run after OpenBot stopped.
