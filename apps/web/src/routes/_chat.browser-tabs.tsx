import { createFileRoute } from "@tanstack/react-router";

import { BrowserTabsPage } from "../components/browserTabs/BrowserTabsPage";

export const Route = createFileRoute("/_chat/browser-tabs")({
  component: BrowserTabsPage,
});
