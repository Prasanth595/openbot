### Changed

- The Usage screen now shows tokens without cache reads in its total, chart and shares. Before, the
  total also counted cache reads, which repeat the cached conversation on each model request. The
  token breakdown still shows cache reads as Cached input. The token chart shows one total line
  instead of one line for each provider.
