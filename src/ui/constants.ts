import { createSignal } from "solid-js";

export const SPINNER_FRAMES = "⠋⠙⠚⠞⠖⠦⠴⠲⠳⠓".split("");

export const ACTIVITY_SPINNERS: Record<string, string[]> = {
  thinking_bkp: "✳✴✶✵✷✸✹✺".split(""),
  thinking: "       ..ooOO@@@@@@*".split(""),
  writing: "▏▎▍▌▋▊▉█▉▊▋▌▍▎".split(""),
  reading: ["⠁", "⠉", "⠋", "⠛", "⠟", "⠿", "⡿", "⣿"],
  running: [" ", "░", "▒", "▓", "█"],
  searching: "◐◓◑◒".split(""),
};

export const SUPERSCRIPT_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

// Shared animation state — one interval drives all spinners. Never stops, never restarts.
const [globalTick, setGlobalTick] = createSignal(0);
setInterval(() => setGlobalTick((t) => t + 1), 80);
export { globalTick };

export function toSuperscript(n: number): string {
  if (n <= 0) return "";
  return String(n)
    .split("")
    .map((d) => SUPERSCRIPT_DIGITS[parseInt(d, 10)] ?? d)
    .join("");
}

export const PULSE_COLORS = ["#005F87", "#0087AF", "#00AFD7", "#00D7FF", "#5FF", "#00D7FF", "#0087AF"];
