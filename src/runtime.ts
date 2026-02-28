import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setOpenClaw Web ChatRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getOpenClaw Web ChatRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("OpenClaw Web Chat runtime not initialized");
  }
  return runtime;
}

// 获取 Core Channel API（用于 dispatchReplyFromConfig）
export function getOpenClaw Web ChatChannel() {
  const rt = getOpenClaw Web ChatRuntime();
  return rt.channel;
}
