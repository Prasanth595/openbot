### Added

- A Workflows page in the page rail. Draw a workflow on a canvas with agent, model, condition, approval and output steps, and connect them. The workflow saves while you edit it.
- Run a workflow, or one step of it. You see each step's status and answer on the canvas, and you can stop, retry or approve a step.
- A condition step asks a model a yes or no question. Only the steps on that branch run.
- A workflow can loop: connect a step back to an earlier step, and the steps between them run again with the new answer. The canvas marks each loop, and warns when no condition can end it.
- An output step shows a notification or posts the result to a connected messaging place. Only an owner or admin can choose the place.
- A workflow can start on a schedule or from a signed webhook request.
- Version history: preview an earlier version of a workflow and restore it. Undo gets back the canvas from before.
- Members of a joined server can open and run the workflows whose agents they can use. To change, delete or restore a workflow, a member needs “Can manage” on each of its agents; otherwise the canvas is read-only.
- Usage shows the tokens of workflow model and condition steps in one Workflows row. Steps that use an agent count under that agent.
- Consecutive model and condition steps reuse one started provider for 5 minutes, so they start faster. Each step still starts with no earlier text.
