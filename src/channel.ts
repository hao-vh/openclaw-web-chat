/**
 * XiaoWu Channel - 借鉴 Feishu Plugin
 * 
 * 完整的 ChannelPlugin 配置
 */

import type { ChannelPlugin, ClawdbotConfig } from "openclaw/plugin-sdk";
import type { ResolvedXiaoWuAccount, XiaoWuConfig } from "./types.js";
import {
  resolveXiaoWuAccount,
  listXiaoWuAccountIds,
  resolveDefaultXiaoWuAccountId,
} from "./accounts.js";
import { xiaowuOutbound } from "./outbound.js";
import { sendMessageXiaoWu } from "./send.js";
import {
  normalizeXiaoWuTarget,
  looksLikeXiaoWuId,
  formatXiaoWuTarget,
} from "./targets.js";
import { monitorXiaoWuProvider } from "./monitor.js";

// Meta 信息
const meta = {
  id: "xiaowu",
  label: "XiaoWu",
  selectionLabel: "XiaoWu Web Chat (小武聊天室)",
  docsPath: "/channels/xiaowu",
  docsLabel: "xiaowu",
  blurb: "Connect your custom Web Chat room to OpenClaw.",
  aliases: [],
  order: 100,
};

/**
 * XiaoWu Channel Plugin 配置
 */
export const xiaowuPlugin: ChannelPlugin<ResolvedXiaoWuAccount> = {
  id: "xiaowu",
  meta,
  
  // 用户配对配置
  pairing: {
    idLabel: "xiaowuUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(xiaowu|user):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      await sendMessageXiaoWu({
        cfg,
        to: `user:${id}`,
        text: "✅ 你已成功连接到 OpenClaw AI 助手！",
      });
    },
  },
  
  // 功能声明
  capabilities: {
    chatTypes: ["direct", "channel"],
    polls: false,        // 暂不支持投票
    threads: false,      // 暂不支持话题
    media: false,        // 暂不支持媒体
    reactions: false,    // 暂不支持表情
    edit: false,         // 暂不支持编辑
    reply: true,         // 支持回复
  },
  
  // Agent 提示
  agentPrompt: {
    messageToolHints: () => [
      "- XiaoWu targeting: use `chat:roomId` for chat rooms, `user:userId` for direct messages.",
      "- XiaoWu is a custom Web Chat integration.",
    ],
  },
  
  // 配置重载
  reload: { configPrefixes: ["channels.xiaowu"] },
  
  // 配置 Schema
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        wsUrl: { 
          type: "string", 
          description: "WebSocket URL (e.g., ws://localhost:3456/ws)" 
        },
        apiUrl: { 
          type: "string", 
          description: "HTTP API base URL (e.g., http://localhost:3456)" 
        },
        apiToken: { 
          type: "string", 
          description: "API authentication token" 
        },
        connectionMode: { 
          type: "string", 
          enum: ["websocket", "http"],
          description: "Connection mode"
        },
        pollInterval: { 
          type: "integer", 
          minimum: 1000,
          description: "HTTP polling interval in milliseconds"
        },
        autoReconnect: { 
          type: "boolean",
          description: "Auto reconnect on disconnect"
        },
        dmPolicy: { 
          type: "string", 
          enum: ["open", "pairing", "allowlist"],
          description: "Direct message policy"
        },
        groupPolicy: { 
          type: "string", 
          enum: ["open", "allowlist", "disabled"],
          description: "Group chat policy"
        },
        accounts: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              name: { type: "string" },
              wsUrl: { type: "string" },
              apiUrl: { type: "string" },
              apiToken: { type: "string" },
              connectionMode: { type: "string", enum: ["websocket", "http"] },
            },
          },
        },
      },
    },
  },
  
  // 账号管理
  config: {
    listAccountIds: (cfg) => listXiaoWuAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveXiaoWuAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultXiaoWuAccountId(cfg),
  },
  
  // 目录服务
  directory: {
    normalizeUserId: (id) => id,
    normalizeRoomId: (id) => id,
  },
  
  // 目标解析
  targets: {
    normalizeTarget: normalizeXiaoWuTarget,
    looksLikeTargetId: looksLikeXiaoWuId,
    formatTarget: formatXiaoWuTarget,
  },
  
  // 网关启动 - 关键：正确启动 monitor
  gateway: {
    startAccount: async (ctx) => {
      console.log("[XiaoWu] Starting provider via gateway.startAccount...");
      ctx.setStatus({ accountId: ctx.accountId, port: null });
      ctx.log?.info(`starting xiaowu provider (mode: websocket)`);
      
      // 调用 monitor 启动消息监听
      return monitorXiaoWuProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
  
  // 发送消息
  send: {
    message: sendMessageXiaoWu,
  },
  
  // 出站适配器 - 关键：用于 Agent 回复
  outbound: xiaowuOutbound,
};
