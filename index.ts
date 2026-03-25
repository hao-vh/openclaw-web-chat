import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { setOpenClawWebChatRuntime } from "./src/runtime.js";
import { sendMessageOpenClawWebChat } from "./src/send.js";
import { webChatOutbound } from "./src/outbound.js";

const meta = {
  id: "web-chat",
  label: "OpenClawWebChat",
  selectionLabel: "OpenClawWebChat Web Chat",
  docsPath: "/channels/web-chat",
  docsLabel: "web-chat",
  blurb: "Connect your custom Web Chat room to OpenClaw.",
  aliases: [],
  order: 100,
};

const webChatPlugin = {
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
      console.log("[OpenClawWebChat] Starting provider...");
      ctx.setStatus({ accountId: ctx.accountId, port: null });
      const { monitorOpenClawWebChatProvider } = await import("./src/monitor.js");
      return monitorOpenClawWebChatProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
  send: {
    message: sendMessageOpenClawWebChat,
  },
  outbound: webChatOutbound,
};

const plugin = {
  id: "web-chat",
  name: "OpenClawWebChat",
  version: "1.3.0",
  description: "OpenClawWebChat Web Chat channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    console.log("[OpenClawWebChat] Registering channel...");
    setOpenClawWebChatRuntime(api.runtime);
    api.registerChannel({ plugin: webChatPlugin });
    console.log("[OpenClawWebChat] Channel registered!");
  },
};

export { webChatPlugin, sendMessageOpenClawWebChat };
export default plugin;
