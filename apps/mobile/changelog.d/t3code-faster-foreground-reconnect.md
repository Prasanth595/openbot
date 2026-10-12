### Fixed

- A server is usable sooner after you return to the app. Before, "Reconnecting" stayed until every chat that you had opened before had loaded again, one after another. Now it ends when the agents and the unread counts load, and the chats load after it, the open chat first.
- After more than 30 seconds away, the app waited 3 seconds for a dead connection before it connected again. Now it repairs the connection at once, or replaces it at once when the server has already dropped it. After more than about 3 minutes away, it shows at once that it connects, instead of a server that looked online but did not answer.
- On a return to the app, the selected server connects first, and your other servers follow when it is online.
- When the server had dropped the connection while the app was in the background, the status showed a short countdown and said that the desktop had restarted. Now it shows that the app connects again, and the message says that the server no longer has the connection.
