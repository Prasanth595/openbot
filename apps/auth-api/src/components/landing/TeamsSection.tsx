import { createSignal, For, onSettled } from "solid-js";
import { LANDING_TEAMS_OFFERS, type LandingTeamsOfferId } from "../../lib/landing-content";
import { ButtonLink } from "../ui/button";
import { LandingIcon, type LandingIconName } from "./LandingIcon";

const OFFER_ICONS: Record<LandingTeamsOfferId, LandingIconName> = {
  servers: "cloud",
  environments: "users",
  integrations: "puzzle",
  support: "heart",
};

const pad = (value: number) => String(value).padStart(2, "0");

/** The heading and the button stay on the left; one colour card for each offer stacks as the page scrolls. */
export function TeamsSection() {
  // The card on top of the stack. The list on the left marks it.
  const [active, setActive] = createSignal(0);
  let stack: HTMLOListElement | undefined;

  onSettled(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!stack) return;
      const cards = Array.from(stack.querySelectorAll<HTMLElement>(":scope > li"));
      const style = getComputedStyle(stack);
      // The distance between two stuck cards, so the label row of each card stays visible.
      const step = Number.parseFloat(style.getPropertyValue("--landing-teams-step"));
      const gap = Number.parseFloat(style.rowGap);
      let top = 0;
      cards.forEach((card, index) => {
        const next = cards[index + 1];
        const box = card.getBoundingClientRect();
        // 0 while the next card is in its place in the list; 1 when it is stuck on top of this one.
        const distance = next ? next.getBoundingClientRect().top - box.top : 0;
        const covered = next ? Math.min(1, Math.max(0, 1 - (distance - step) / (box.height + gap - step))) : 0;
        card.style.setProperty("--landing-teams-covered", covered.toFixed(3));
        if (covered > 0.5) top = index + 1;
      });
      setActive(top);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  });

  return (
    <section id="teams" class="landing-section landing-teams" aria-labelledby="teams-title">
      <div class="landing-section-inner landing-teams-layout">
        <header class="landing-section-heading landing-teams-aside">
          <h2 id="teams-title" class="landing-teams-title">
            OpenBot for Teams
          </h2>
          <p class="landing-teams-statement">AI coworkers for your whole company.</p>
          <p class="landing-teams-description">
            We run OpenBot on managed servers and set it up around your team and tools.
          </p>
          <ButtonLink to="/contact" variant="primary" size="lg" icon="contact" class="landing-teams-action">
            Contact us
          </ButtonLink>
          <ol class="landing-teams-progress" aria-hidden="true">
            <For each={LANDING_TEAMS_OFFERS}>
              {(offer, index) => (
                <li
                  class="landing-teams-progress-item"
                  data-offer={offer.id}
                  data-active={active() === index() ? "" : undefined}
                >
                  <span class="landing-teams-progress-number">{pad(index() + 1)}</span>
                  {offer.label}
                </li>
              )}
            </For>
          </ol>
        </header>
        <ol ref={stack} class="landing-teams-stack">
          <For each={LANDING_TEAMS_OFFERS}>
            {(offer, index) => (
              <li class="landing-teams-card" data-offer={offer.id} style={{ "--landing-teams-card": index() }}>
                <span class="landing-teams-card-top">
                  <span class="landing-download-status">{offer.label}</span>
                  <span class="landing-teams-card-number" aria-hidden="true">
                    {pad(index() + 1)} / {pad(LANDING_TEAMS_OFFERS.length)}
                  </span>
                </span>
                <span class="landing-teams-card-mark">
                  <LandingIcon name={OFFER_ICONS[offer.id]} class="landing-teams-card-icon" />
                </span>
                <div class="landing-teams-card-copy">
                  <h3 class="landing-teams-card-title">{offer.title}</h3>
                  <p class="landing-teams-card-description">{offer.description}</p>
                </div>
              </li>
            )}
          </For>
        </ol>
      </div>
    </section>
  );
}
