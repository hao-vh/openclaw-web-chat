import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setXiaoWuRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getXiaoWuRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("XiaoWu runtime not initialized");
  }
  return runtime;
}

// 获取 Core Channel API（用于 dispatchReplyFromConfig）
export function getXiaoWuChannel() {
  const rt = getXiaoWuRuntime();
  return rt.channel;
}
