import type { MenuComponentProps } from "@expo/ui/community/menu";
import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PressableProps } from "react-native";
import { afterEach, expect, it, vi } from "vitest";
import type { MobileSession } from "@/features/auth/api/mobile-auth";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { ServerDrawerContent } from "./server-drawer-content";

// These DOM boundaries expose the actual native action labels, state, and callbacks.
// They do not test platform menu rendering or appearance.
vi.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ children, actions, onPressAction }: MenuComponentProps) => (
    <div>
      {children}
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitemcheckbox"
          aria-checked={action.state === "on"}
          onClick={() => onPressAction?.({ nativeEvent: { event: action.id ?? action.title } })}
        >
          {action.title}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  ScrollView: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Pressable: ({
    children,
    accessibilityLabel,
    accessibilityState,
    accessibilityActions,
    onAccessibilityAction,
  }: Omit<PressableProps, "onAccessibilityAction"> & {
    onAccessibilityAction?: (event: { nativeEvent: { actionName: string } }) => void;
  }) => (
    <div>
      <button type="button" aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected}>
        {typeof children === "function" ? null : children}
      </button>
      {accessibilityActions?.map((action) => (
        <button
          key={action.name}
          type="button"
          onClick={() => onAccessibilityAction?.({ nativeEvent: { actionName: action.name } })}
        >
          {action.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("heroui-native", () => ({
  Typography: {
    Heading: ({ children }: PropsWithChildren) => <span>{children}</span>,
    Paragraph: ({ children }: PropsWithChildren) => <span>{children}</span>,
  },
}));
vi.mock("lucide-react-native", () => ({ Check: () => null, Plus: () => null, Settings: () => null }));
vi.mock("uniwind", () => ({ useUniwind: () => ({ theme: "light" }) }));
vi.mock("@/shared/lib/platform", () => ({ isAndroid: false }));
vi.mock("@/shared/lib/haptics", () => ({ haptics: { selection: async () => {} } }));
vi.mock("@/shared/lib/dev-feature-overrides", () => ({ devFeatureOverride: () => false }));
vi.mock("@/shared/lib/mobile-features", () => ({
  useMobileFeature: () => false,
  refreshMobileFeatures: async () => {},
}));
vi.mock("@/features/servers/model/hosted-server-availability", () => ({
  useHostedServerAvailability: () => false,
  refreshHostedServerAvailability: async () => {},
}));
vi.mock("@/features/servers/api/hosted-servers", () => ({ hostedServerCalls: () => ({}) }));
vi.mock("@/shared/components/profile-avatar", () => ({ ProfileAvatar: () => null }));
vi.mock("@/shared/components/sheet-scroll-edge-effect", () => ({ SheetScrollEdgeEffect: () => null }));
vi.mock("./server-avatar", () => ({ ServerAvatar: () => null }));
vi.mock("./server-drawer-icon-button", () => ({ ServerDrawerIconButton: () => null }));
vi.mock("./sortable-server-list", () => ({ SERVER_ROW_HEIGHT: 64, SortableServerList: () => null }));

const server: MobileServer = {
  id: "remote",
  name: "Desktop",
  kind: "remote",
  state: "offline",
  initialConnectionPending: false,
  connectionMessage: null,
  address: null,
  accent: "",
  publicKey: "test-key",
  logoKey: null,
  membershipId: "membership",
  role: "member",
};
const session: MobileSession = {
  apiUrl: "https://account.example.com",
  sessionToken: "test-token",
  user: { id: "user", name: "User", email: "user@example.com", avatarUrl: null },
  host: { hostId: "local", fingerprint: "test-fingerprint" },
};
const saved = vi.fn();
function Drawer() {
  const [startupServerId, setStartupServerId] = useState<string | null>(null);
  return (
    <ServerDrawerContent
      activeServerId="local"
      headerHeight={64}
      listTopInset={64}
      muted="gray"
      open
      servers={[server]}
      session={session}
      sideInset={16}
      topInset={16}
      startupServerId={startupServerId}
      onNavigate={() => {}}
      onReorder={() => true}
      onSelectServer={() => {}}
      onSetStartupServer={(id) => {
        saved(id);
        setStartupServerId(id);
        return true;
      }}
    />
  );
}
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
  saved.mockClear();
});

it("sets and clears the offline startup server through native menu and accessibility actions", async () => {
  await act(() => root.render(<Drawer />));
  expect(screen.getByRole("menuitemcheckbox", { name: "Use at startup", checked: false })).toBeTruthy();
  expect(screen.queryByRole("menuitemcheckbox", { name: "Clear startup server" })).toBeNull();
  await act(() => fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Use at startup" })));
  expect(saved).toHaveBeenLastCalledWith("remote");
  expect(screen.getByRole("menuitemcheckbox", { name: "Use at startup", checked: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Desktop, Remote, Offline, Startup server", pressed: false })).toBeTruthy();
  await act(() => fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Clear startup server" })));
  expect(saved).toHaveBeenLastCalledWith(null);
  expect(screen.getByRole("menuitemcheckbox", { name: "Use at startup", checked: false })).toBeTruthy();
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Use at startup" })));
  expect(saved).toHaveBeenLastCalledWith("remote");
  await act(() => fireEvent.click(screen.getByRole("button", { name: "Clear startup server" })));
  expect(saved).toHaveBeenLastCalledWith(null);
  expect(screen.getByRole("button", { name: "Desktop, Remote, Offline" })).toBeTruthy();
});
