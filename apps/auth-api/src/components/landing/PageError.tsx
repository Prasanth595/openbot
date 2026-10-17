import { TransactionalPage } from "../transactional/TransactionalPage";
import { Button } from "../ui/button";

const COPY = {
  title: "This page could not load",
  body: "Check your connection and reload the page. If it still does not load, go back to the home page.",
  reload: "Reload page",
  home: "Back to home",
} as const;

export function PageError(props: { onRetry: () => void }) {
  return (
    <TransactionalPage titleId="page-error-title">
      <h1 id="page-error-title">{COPY.title}</h1>
      <p class="join-card-copy" role="alert">
        {COPY.body}
      </p>
      <div class="join-card-actions">
        <Button as="button" type="button" variant="primary" size="lg" icon="arrow-right" onClick={props.onRetry}>
          {COPY.reload}
        </Button>
        {/* A full page load: the router state after an error is not safe to reuse. */}
        <Button href="/" variant="secondary" size="lg" icon="open">
          {COPY.home}
        </Button>
      </div>
    </TransactionalPage>
  );
}
