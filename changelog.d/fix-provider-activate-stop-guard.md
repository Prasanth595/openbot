### Fixed

- Stop the provider processes when OpenBot quits while it changes a provider key, updates a provider CLI or reconnects a provider. Before, the new process, or the process that it replaced, could continue to run after OpenBot stopped.
