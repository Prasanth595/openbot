import { NotificationObserver, Toaster } from "@openbot/ui";
import { AppAccessGate } from "./AppView";
import { type AppProps, AppProviders } from "./app-providers";
import { reportNotification, retainErrorReceipt } from "./error-reports";

export function App(props: AppProps = {}) {
  return (
    <NotificationObserver onShown={reportNotification} onErrorShown={retainErrorReceipt}>
      <AppProviders landingPreview={props.landingPreview} peopleEnabled={props.peopleEnabled}>
        <AppAccessGate />
      </AppProviders>
      <Toaster onToastShown={reportNotification} onErrorShown={retainErrorReceipt} />
    </NotificationObserver>
  );
}
