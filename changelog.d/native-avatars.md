### Changed

- Agent avatars are drawn by OpenBot itself instead of the Bloub library. There are eight soft body shapes with no
  sharp corners: circle, pebble, squircle, capsule, onigiri, hex, cloud and egg. Each has a light sheen and capsule
  eyes. Existing agents keep the shape, face and colour they had.
- The avatar editor in an agent's settings now picks the shape, the colour and the expression separately. Each
  choice shows a live preview with the other two, and a pick saves at once. "Shuffle" picks all three at random.
- A busy avatar shows what the agent is doing with CSS only: it breathes with a turning ring while it works,
  sways while it waits for a reply, hops when it finishes, droops when a turn fails, and floats a "z" while it
  sleeps.
