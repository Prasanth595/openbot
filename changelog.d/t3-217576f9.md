### Fixed

- An agent whose plan ran out of usage can now change to a model of another provider. Before, the
  change failed with "Could not change model" while the agent held a queued message, and the agent
  stayed on the spent plan until it reset. The queued message now runs on the new model.
