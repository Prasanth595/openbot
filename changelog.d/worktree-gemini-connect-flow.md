### Added

- You can cancel a Gemini (or other browser) sign-in that waits for the browser. Before, the only way out was Restart, which opened another sign-in page.
- While a provider connects, its row tells you to finish the sign-in in your browser.

### Fixed

- The Google sign-in for Gemini no longer stops when you return to OpenBot before you finish it in the browser on the first-run screen.
- A failed Gemini sign-in now shows the reason, such as a timeout or Google's own message. Before, every failure showed "OpenBot could not connect Gemini. Try again."
- When Google refuses a saved Gemini API key, OpenBot says so. Before, it asked you to sign in with Google, which could not help while the key was saved.
- OpenBot no longer opens a Google sign-in page by itself when it checks Gemini with an expired sign-in. It shows "Sign in with Google to use Gemini." at once, without a long wait.
- A Gemini chat whose session was lost now starts a new session. Before, every next message in that chat failed.
- When the Gemini plan's quota is reached, the turn fails with a clear message. Before, the quota notice was saved as Gemini's answer.
- Gemini no longer asks for approval of a tool after you press Stop.
- Provider rows in Settings show why a provider is not ready, or why its download failed, as text. Before, the reason was only in a tooltip.
- A Connect that fails in Settings, the model picker or the chat composer now shows why.
- The Gemini row and other downloaded providers show "Update available" in Settings, as the update notification does.
- On the first-run screen, the main button downloads the selected provider when it is not downloaded, and says Download.
