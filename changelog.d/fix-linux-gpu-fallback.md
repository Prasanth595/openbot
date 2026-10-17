### Fixed

- Use the GPU again on Linux. Before, OpenBot always rendered on the CPU on Linux, so dialogs and
  panels with a blurred background were slow on computers whose GPU works. If the GPU process
  crashes, or a start stops before it is complete, later starts use software rendering, as before,
  until an update with a new Chromium version. A server (`OPENBOT_SERVER=1` or a hosted server)
  always uses software rendering. Set `OPENBOT_DISABLE_GPU=1` to always use software rendering, or
  `OPENBOT_DISABLE_GPU=0` to try the GPU again.
