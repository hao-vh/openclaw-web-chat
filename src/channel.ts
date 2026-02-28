/**
 * OpenClaw Web Chat Channel - 借鉴 Feishu Plugin
 * 
 * 完整的 ChannelPlugin 配置
 */

import type { ChannelPlugin, ClawdbotConfig } from "openclaw/plugin-sdk";
import type { ResolvedOpenClaw Web ChatAccount, OpenClaw Web ChatConfig } from "./types.js";
import {
  resolveOpenClaw Web ChatAccount,
  listOpenClaw Web ChatAccountIds,
  resolveDefaultOpenClaw Web ChatAccountId,
} from "./accounts.js";
import { web-chatOutbound } from "./outbound.js";
import { sendMessageOpenClaw Web Chat } from "./send.js";
import {
  normalizeOpenClaw Web ChatTarget,
  looksLikeOpenClaw Web ChatId,
  formatOpenClaw Web ChatTarget,
} from "./targets.js";
import { monitorOpenClaw Web ChatProvider } from "./monitor.js";

// Meta 信息
const meta = {
  id: "web-chat",
  label: "OpenClaw Web Chat",
  selectionLabel: "OpenClaw Web Chat Web Chat (OpenClaw Web Chat聊天室)",
  docsPath: "/channels/web-chat",
  docsLabel: "web-chat",
  blurb: "Connect your custom Web Chat room to OpenClaw.",
  aliases: [],
  order: 100,
};

/**
 * OpenClaw Web Chat Channel Plugin 配置
 */
export const web-chatPlugin: ChannelPlugin<ResolvedOpenClaw Web ChatAccount> = {
  id: "web-chat",
  meta,
  
  // 用户配对配置
  pairing: {
    idLabel: "web-chatUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(web-chat|user):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      await sendMessageOpenClaw Web Chat({
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
      "- OpenClaw Web Chat targeting: use `chat:roomId` for chat rooms, `user:userId` for direct messages.",
      "- OpenClaw Web Chat is a custom Web Chat integration.",
    ],
  },
  
  // 配置重载
  reload: { configPrefixes: ["channels.web-chat"] },
  
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
    listAccountIds: (cfg) => listOpenClaw Web ChatAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveOpenClaw Web ChatAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultOpenClaw Web ChatAccountId(cfg),
  },
  
  // 目录服务
  directory: {
    normalizeUserId: (id) => id,
    normalizeRoomId: (id) => id,
  },
  
  // 目标解析
  targets: {
    normalizeTarget: normalizeOpenClaw Web ChatTarget,
    looksLikeTargetId: looksLikeOpenClaw Web ChatId,
    formatTarget: formatOpenClaw Web ChatTarget,
  },
  
  // 网关启动 - 关键：正确启动 monitor
  gateway: {
    startAccount: async (ctx) => {
      console.log("[OpenClaw Web Chat] Starting provider via gateway.startAccount...");
      ctx.setStatus({ accountId: ctx.accountId, port: null });
      ctx.log?.info(`starting web-chat provider (mode: websocket)`);
      
      // 调用 monitor 启动消息监听
      return monitorOpenClaw Web ChatProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
  
  // 发送消息
  send: {
    message: sendMessageOpenClaw Web Chat,
  },
  
  // 出站适配器 - 关键：用于 Agent 回复
  outbound: web-chatOutbound,
};
