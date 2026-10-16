import { AgentHoneycomb, honeycombRows } from "./AgentHoneycomb";

const BAND_ROWS = honeycombRows(5, 24, 5, "band");

/**
 * A full-width band of agent faces that drifts to the left, before the download section. It has no text:
 * the heading of the next section reads under it. Decorative, so assistive technology skips it.
 */
export function LandingAgentBand() {
  return (
    <section class="landing-agent-band" aria-hidden="true">
      {/* Two copies side by side: the drift moves one width, then starts again without a jump. */}
      <div class="landing-agent-band-drift">
        <AgentHoneycomb rows={BAND_ROWS} />
        <AgentHoneycomb rows={BAND_ROWS} />
      </div>
    </section>
  );
}
