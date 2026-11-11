import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Electron from "electron";

import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import { toElectronAccelerator } from "../snapShot/snapShot.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

// The web app answers this menu action by opening the next thread that needs you.
const NEXT_ATTENTION_ACTION = "thread.nextAttention";

export class DesktopAttentionShortcut extends Context.Service<
  DesktopAttentionShortcut,
  {
    readonly initialize: Effect.Effect<void>;
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopAttentionShortcut") {}

const make = Effect.gen(function* () {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let registeredAccelerator: string | null = null;

  const unregister = () => {
    if (registeredAccelerator !== null) Electron.globalShortcut.unregister(registeredAccelerator);
    registeredAccelerator = null;
  };
  const onShortcut = () => {
    void runPromise(
      desktopWindow
        .dispatchMenuAction(NEXT_ATTENTION_ACTION, { reveal: true })
        .pipe(Effect.ignoreCause),
    );
  };

  const configure = Effect.fn("desktop.attentionShortcut.configure")(function* (
    settings: ClientSettings,
  ) {
    const shortcut = settings.attentionGlobalShortcut;
    const accelerator = shortcut === null ? null : toElectronAccelerator(shortcut);
    if (accelerator === registeredAccelerator) return;
    unregister();
    if (accelerator === null) return;
    if (Electron.globalShortcut.register(accelerator, onShortcut)) {
      registeredAccelerator = accelerator;
      return;
    }
    yield* Effect.logWarning("attention shortcut is already used by the system or another app", {
      accelerator,
    });
  });

  yield* Effect.addFinalizer(() => Effect.sync(unregister));

  return DesktopAttentionShortcut.of({
    initialize: clientSettings.get.pipe(
      Effect.flatMap((stored) =>
        configure(Option.getOrElse(stored, () => DEFAULT_CLIENT_SETTINGS)),
      ),
      Effect.ignore,
    ),
    configure,
  });
});

export const layer = Layer.effect(DesktopAttentionShortcut, make);
