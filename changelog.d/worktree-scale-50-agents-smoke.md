### Fixed

- An agent that sent many messages to teammates made each chat open and each finished turn slower, because OpenBot searched all saved message keys again for each message. It now reads them once.
