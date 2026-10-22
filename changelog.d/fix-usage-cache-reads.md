### Changed

- The Usage tab now shows tokens without cache reads in its total, chart, shares and daily data.
  Before, the total also counted cache reads. Each model request in a turn reads the whole cached
  conversation again, so cache reads made the total about ten times larger than the new tokens.
  Totals still show cache reads as Cached input, and the estimated cost does not change. For a
  remote server, the token chart shows one total line instead of one line for each provider.
