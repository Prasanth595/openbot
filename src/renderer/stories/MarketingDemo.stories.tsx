import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MarketingDemo } from "../src/preview/MarketingDemo";
import "../src/preview/preview.css";

const meta = {
  title: "App/Marketing demo",
  component: MarketingDemo,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MarketingDemo>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Marketing: Story = {
  render: () => (
    <div class="openbot-playground-root">
      <MarketingDemo />
    </div>
  ),
};
