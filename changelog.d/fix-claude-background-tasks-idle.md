### Fixed

- Claude background subagents keep running after the agent's turn ends. Before, OpenBot stopped the idle Claude process after 10 minutes and ended every subagent with "Stream closed", so long research had to start again.
