import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { setOpenClaw Web ChatRuntime } from "./src/runtime.js";
import { sendMessageOpenClaw Web Chat } from "./src/send.js";
import { web-chatOutbound } from "./src/outbound.js";

const meta = {
  id: "web-chat",
  label: "OpenClaw Web Chat",
  selectionLabel: "OpenClaw Web Chat Web Chat",
  docsPath: "/channels/web-chat",
  docsLabel: "web-chat",
  blurb: "Connect your custom Web Chat room to OpenClaw.",
  aliases: [],
  order: 100,
};

const web-chatPlugin = {
  id: "web-chat",
  meta,
  capabilities: {
    chatTypes: ["direct", "channel"],
    polls: false,
    threads: false,
    media: false,
    reactions: false,
    edit: false,
    reply: true,
  },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({ enabled: true, configured: true }),
    defaultAccountId: () => "default",
  },
  gateway: {
    startAccount: async (ctx) => {
      console.log("[OpenClaw Web Chat] Starting provider...");
      ctx.setStatus({ accountId: ctx.accountId, port: null });
      const { monitorOpenClaw Web ChatProvider } = await import("./src/monitor.js");
      return monitorOpenClaw Web ChatProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
  send: {
    message: sendMessageOpenClaw Web Chat,
  },
  outbound: web-chatOutbound,
};

const plugin = {
  id: "web-chat",
  name: "OpenClaw Web Chat",
  version: "1.3.0",
  description: "OpenClaw Web Chat Web Chat channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    console.log("[OpenClaw Web Chat] Registering channel...");
    setOpenClaw Web ChatRuntime(api.runtime);
    api.registerChannel({ plugin: web-chatPlugin });
    console.log("[OpenClaw Web Chat] Channel registered!");
  },
};

export { web-chatPlugin, sendMessageOpenClaw Web Chat };
export default plugin;
