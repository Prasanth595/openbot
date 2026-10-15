### Added

- A working agent has turning rings around its avatar on the home screen, as on the desktop.

### Changed

- The home screen stays smooth on a server with many agents. A new message updates only the row of
  its agent, and the list keeps fewer rows ready off the screen.
- Agent avatars draw with less work, mostly on Android. A working face plays at 30 frames per second
  on Android, as on the desktop.
- On Android, a chat slides in as soon as you tap its agent, and its messages show when it is in
  place. Before, the chat came only after all its messages had rendered.
- On Android, the home screen no longer keeps a long-press menu ready for each agent. The menu is
  made when you touch and hold the agent.
- A chat opens with less work. The app reads the phone's language once instead of once for each
  message, keeps message rows from drawing again for each change in the chat, and reuses the
  formatted text and highlighted code of messages it showed before.
- Sheets with header buttons on Android, such as Create agent, no longer rebuild the header on each
  key press. The colour glow and the face choices of Create agent change colour with less work.

### Fixed

- The Live Activity showed "Working" after the agent finished its reply. It now stops when the turn
  ends.
