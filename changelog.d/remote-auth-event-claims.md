### Fixed

- Send each sign-out and account change to connected apps once. Before, the account service could
  send the same change two times, and a slow connection service could stop the cloud server check
  for minutes.
