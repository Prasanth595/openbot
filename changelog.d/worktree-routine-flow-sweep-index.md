### Fixed

- The routine flow check after each turn and queue change reads only the runs it can move. Before, it
  read every routine run and flow step of the last 7 days each time, so a routine that runs often
  slowed OpenBot.
