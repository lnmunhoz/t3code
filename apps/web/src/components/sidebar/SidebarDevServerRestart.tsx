import { RotateCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { readLocalApi } from "../../localApi";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const LABEL = "Restart to load server changes";

async function restart() {
  const confirmed = await readLocalApi()?.dialogs.confirm(
    "Restart T3 Code to load the new server build? Agents that are working will stop.",
  );
  if (confirmed) await window.desktopBridge?.restartForDevServerBuild?.();
}

/** Dev desktop only: shows once dev:desktop has rebuilt the server and the new build differs. */
export function SidebarDevServerRestart() {
  const [ready, setReady] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the desktop main process.
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.getDevServerBuildReady || !bridge.onDevServerBuildReady) return;
    let active = true;
    void bridge.getDevServerBuildReady().then((value) => {
      if (active) setReady(value);
    });
    const unsubscribe = bridge.onDevServerBuildReady(setReady);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  if (!ready) return null;
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={LABEL} onClick={() => void restart()} size="icon">
              <RotateCwIcon />
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{LABEL}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
