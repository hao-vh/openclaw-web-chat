import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setOpenClawWebChatRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getOpenClawWebChatRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("OpenClawWebChat runtime not initialized");
  }
  return runtime;
}

// 获取 Core Channel API（用于 dispatchReplyFromConfig）
export function getOpenClawWebChatChannel() {
  const rt = getOpenClawWebChatRuntime();
  return rt.channel;
}
