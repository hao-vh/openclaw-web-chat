import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { setXiaoWuRuntime } from "./src/runtime.js";
import { sendMessageXiaoWu } from "./src/send.js";
import { xiaowuOutbound } from "./src/outbound.js";

const meta = {
  id: "xiaowu",
  label: "XiaoWu",
  selectionLabel: "XiaoWu Web Chat",
  docsPath: "/channels/xiaowu",
  docsLabel: "xiaowu",
  blurb: "Connect your custom Web Chat room to OpenClaw.",
  aliases: [],
  order: 100,
};

const xiaowuPlugin = {
  id: "xiaowu",
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
      console.log("[XiaoWu] Starting provider...");
      ctx.setStatus({ accountId: ctx.accountId, port: null });
      const { monitorXiaoWuProvider } = await import("./src/monitor.js");
      return monitorXiaoWuProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
  send: {
    message: sendMessageXiaoWu,
  },
  outbound: xiaowuOutbound,
};

const plugin = {
  id: "xiaowu",
  name: "XiaoWu",
  version: "1.3.0",
  description: "XiaoWu Web Chat channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    console.log("[XiaoWu] Registering channel...");
    setXiaoWuRuntime(api.runtime);
    api.registerChannel({ plugin: xiaowuPlugin });
    console.log("[XiaoWu] Channel registered!");
  },
};

export { xiaowuPlugin, sendMessageXiaoWu };
export default plugin;
