import { createSignal, onCleanup, For } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { COLORS } from "./theme.js";
import { SPLASH_FRAMES } from "./splash-frames-octo.js";

const FRAME_INTERVAL = 120; // ms per frame

export function SplashScreen() {
  const dims = useTerminalDimensions();
  const [frameIndex, setFrameIndex] = createSignal(0);

  const timer = setInterval(() => {
    setFrameIndex((i) => (i + 1) % SPLASH_FRAMES.length);
  }, FRAME_INTERVAL);

  onCleanup(() => clearInterval(timer));

  const frame = () => SPLASH_FRAMES[frameIndex()] ?? [];
  const artHeight = () => frame().length + 3;
  const topPad = () => Math.max(0, Math.floor((dims().height - artHeight() - 4) / 2));

  return (
    <box flexDirection="column" width="100%" alignItems="center" paddingTop={topPad()}>
      <For each={frame()}>{(line) => (
        <text fg={COLORS.primary} selectable={false}>{line}</text>
      )}</For>
      <text>{" "}</text>
      <text fg={COLORS.primary}>llm-party</text>
      <text fg={COLORS.textDim}>multi-agent terminal</text>
    </box>
  );
}
