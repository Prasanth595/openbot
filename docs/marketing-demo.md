# Public marketing demo

Open `/app-preview?useCase=marketing` on the OpenBot site. The demo uses the existing application preview. The embedded landing preview keeps its current behavior.

The fictional Cedar Studio workspace has three agents. The guided examples show campaign planning, audience research, content drafts, a client update, and a weekly report. The Content agent has a sample weekly report routine. Sample files and installed skill descriptions use the same fictional brief.

Every response is simulated. A guided request selects a fixed sample result. Other text receives an unsupported-request notice. The demo does not call a model. It does not send mail, publish content, visit websites, or run commands. Account and provider controls use the existing in-memory preview API. No real account, credential, integration, or file is available to that API. Microphone capture is disabled for this demo.

**Reset demo** disposes the current renderer and mock, then creates them again from the manifest. It discards drafts, queues, selected panels, routines changed during the session, and pending mock work. **Exit demo** ends that mount. **Open a fresh demo** starts a new one. Display preferences use private memory storage for this mount. Saved product data is not copied or erased. The prior storage descriptor and preview bridge are restored only while the demo still owns them.

**Start using OpenBot** opens the existing `/app` entry with a full document navigation. Account setup is outside the demo.

## Add a use case

`src/renderer/src/preview/marketing-demo-manifest.ts` defines `PreviewUseCaseManifest`, version 1. A manifest contains agent profiles, fixed guided prompts and results, routine definitions, skill summaries, and file contents. It cannot contain executable scripts or provider callbacks. `createUseCaseOptions` adapts this data to the existing preview API. Add a fixed route identifier and localized labels for another supported manifest. Do not accept arbitrary visitor configuration.

## Verification

Run `bun scripts/marketing-demo-e2e.ts` from the repository root. The script starts the real local public route in an owned Vite server. It uses a new headless browser context with no account. The report is `.openbot-build/marketing-demo-e2e/report.json`. Review captures stay in that ignored directory.

The fixture checks guided actions and agent switching. It checks an unsupported free-text request and routine execution. It also checks reset during a turn, reset after completion, fresh sessions, and exit/remount. It blocks non-static requests and external origins. The report identifies the source files, run, runtime, and cleanup result.

Analytics and additional use cases remain follow-up work. This demo sends no visitor input or exploration analytics. A local route check does not prove a production deployment. Desktop and mobile browser layouts are checked; this change does not add a native mobile demo.
