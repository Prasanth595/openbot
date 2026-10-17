### Fixed

- The daily billing snapshot reads only open subscriptions from Stripe. Before, it also read every
  canceled subscription, and one subscription with bad data stopped all snapshots. Now the snapshot
  counts such a subscription in `skipped_subscriptions` and leaves it out.
