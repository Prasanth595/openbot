### Fixed

- Route channel messages again when the lead agent uses a free OpenCode model. Before, every
  message stopped with "Routing failed. Choose a member or try again.", because OpenCode refused the
  routing request. Agent profiles that a free OpenCode model writes work again too.
