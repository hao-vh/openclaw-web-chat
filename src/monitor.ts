/**
 * OpenClaw Web Chat Monitor - 借鉴 Feishu Plugin 最佳实践
 * 
 * 消息监听和 Agent 触发
 */

import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import { resolveOpenClaw Web ChatAccount, listEnabledOpenClaw Web ChatAccounts } from "./accounts.js";
import { registerMessageHandler, closeWSConnection, pollOpenClaw Web ChatMessages } from "./client.js";
import { getOpenClaw Web ChatChannel } from "./runtime.js";
import { sendMessageOpenClaw Web Chat } from "./send.js";
import type { ResolvedOpenClaw Web ChatAccount, OpenClaw Web ChatMessageEvent } from "./types.js";

export interface MonitorOpenClaw Web ChatOpts {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
}

async function monitorSingleAccount(
  account: ResolvedOpenClaw Web ChatAccount,
  opts: MonitorOpenClaw Web ChatOpts
): Promise<void> {
  const { config, runtime, abortSignal } = opts;
  const log = runtime?.log ?? console.log;
  const { accountId, connectionMode } = account;
  
  log(`[OpenClaw Web Chat ${accountId}] Starting monitor (mode: ${connectionMode})...`);
  
  const chatHistories = new Map<string, HistoryEntry[]>();
  
  if (connectionMode === "websocket") {
    return monitorWebSocket(account, opts, chatHistories);
  } else {
    return monitorHTTP(account, opts, chatHistories);
  }
}

async function monitorWebSocket(
  account: ResolvedOpenClaw Web ChatAccount,
  opts: MonitorOpenClaw Web ChatOpts,
  chatHistories: Map<string, HistoryEntry[]>
): Promise<void> {
  const { config, runtime, abortSignal } = opts;
  const log = runtime?.log ?? console.log;
  const { accountId } = account;
  
  return new Promise((resolve) => {
    const handleMessage = async (event: OpenClaw Web ChatMessageEvent) => {
      try {
        log(`[OpenClaw Web Chat ${accountId}] Processing message from ${event.senderName}`);
        
        // 获取 Core Channel API
        const core = getOpenClaw Web ChatChannel();
        const isGroup = !event.isDirect;
        
        // 解析路由
        const route = core.routing.resolveAgentRoute({
          cfg: config,
          channel: "web-chat",
          peer: { kind: isGroup ? "group" : "dm", id: isGroup ? event.chatId : event.senderId },
        });
        
        log(`[OpenClaw Web Chat ${accountId}] Routed to agent: ${route.sessionKey}`);
        
        // 创建 deliver 函数 - 发送回复到 Web 聊天室
        const deliver = async (payload: any) => {
          const text = payload.text ?? "";
          if (!text.trim()) return;
          
          log(`[OpenClaw Web Chat ${accountId}] Delivering: ${text.slice(0, 50)}...`);
          
          try {
            const result = await sendMessageOpenClaw Web Chat({
              cfg: config!,
              to: `chat:${event.chatId}`,
              text: text,
              replyTo: event.messageId,
            });
            
            if (result.error) {
              log(`[OpenClaw Web Chat ${accountId}] Send failed: ${result.error}`);
            } else {
              log(`[OpenClaw Web Chat ${accountId}] Send success: ${result.messageId}`);
            }
          } catch (err) {
            log(`[OpenClaw Web Chat ${accountId}] Send error: ${err}`);
          }
        };
        
        // 创建回复分发器
        const replyResult = core.reply.createReplyDispatcherWithTyping({
          deliver,
          onError: (err: Error, info: any) => {
            log(`[OpenClaw Web Chat ${accountId}] deliver error: ${err}`);
          },
          onIdle: () => {
            log(`[OpenClaw Web Chat ${accountId}] dispatcher idle`);
          },
        });
        
        const { dispatcher, replyOptions, markDispatchIdle } = replyResult;
        
        // 关键修复：确保 replyOptions 包含 reply 属性
        const finalReplyOptions = {
          ...replyOptions,
          reply: dispatcher,
        };
        
        // 构建 envelope
        const envelopeOptions = core.reply.resolveEnvelopeFormatOptions(config);
        const body = core.reply.formatAgentEnvelope({
          channel: "OpenClaw Web Chat",
          from: isGroup ? `${event.chatId}:${event.senderId}` : event.senderId,
          timestamp: new Date(),
          envelope: envelopeOptions,
          body: `${event.senderName}: ${event.content}`,
        });
        
        // 构建上下文
        const ctxPayload = core.reply.finalizeInboundContext({
          Body: body,
          RawBody: event.content,
          CommandBody: event.content,
          From: event.senderId,
          To: `chat:${event.chatId}`,
          SessionKey: route.sessionKey,
          AccountId: route.accountId,
          ChatType: isGroup ? "group" : "direct",
          GroupSubject: isGroup ? event.chatId : undefined,
          SenderName: event.senderName ?? event.senderId,
          SenderId: event.senderId,
          Provider: "web-chat" as const,
          Surface: "web-chat" as const,
          MessageSid: event.messageId,
          Timestamp: Date.now(),
          WasMentioned: true,
          CommandAuthorized: true,
          OriginatingChannel: "web-chat" as const,
          OriginatingTo: `chat:${event.chatId}`,
        });
        
        log(`[OpenClaw Web Chat ${accountId}] Dispatching to agent...`);
        
        // 关键：调用 dispatchReplyFromConfig 触发 Agent
        const { queuedFinal, counts } = await core.reply.dispatchReplyFromConfig({
          ctx: ctxPayload,
          cfg: config,
          dispatcher,
          replyOptions: finalReplyOptions,
        });
        
        markDispatchIdle();
        
        log(`[OpenClaw Web Chat ${accountId}] Dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
        
        // 保存历史
        const historyKey = `${accountId}:${event.chatId}`;
        const history = chatHistories.get(historyKey) || [];
        history.push({ role: "user", content: event.content, timestamp: event.timestamp });
        chatHistories.set(historyKey, history);
      } catch (err) {
        log(`[OpenClaw Web Chat ${accountId}] Error handling message: ${err}`);
      }
    };
    
    // 注册消息处理器
    const cleanup = registerMessageHandler(accountId, account.config, handleMessage);
    
    // 处理终止
    const handleAbort = () => {
      log(`[OpenClaw Web Chat ${accountId}] Abort signal received, stopping`);
      cleanup();
      closeWSConnection(accountId);
      resolve();
    };
    
    if (abortSignal?.aborted) {
      handleAbort();
      return;
    }
    
    abortSignal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function monitorHTTP(
  account: ResolvedOpenClaw Web ChatAccount,
  opts: MonitorOpenClaw Web ChatOpts,
  chatHistories: Map<string, HistoryEntry[]>
): Promise<void> {
  const { runtime } = opts;
  const log = runtime?.log ?? console.log;
  log("[OpenClaw Web Chat] HTTP polling not fully implemented");
}

export async function monitorOpenClaw Web ChatProvider(
  opts: MonitorOpenClaw Web ChatOpts = {}
): Promise<void> {
  const { config, runtime, accountId } = opts;
  const log = runtime?.log ?? console.log;
  
  if (!config) {
    throw new Error("Config is required for OpenClaw Web Chat monitor");
  }
  
  if (accountId) {
    const account = resolveOpenClaw Web ChatAccount({ cfg: config, accountId });
    if (!account.enabled || !account.configured) {
      throw new Error(`OpenClaw Web Chat account "${accountId}" not configured or disabled`);
    }
    return monitorSingleAccount(account, opts);
  }
  
  const accounts = listEnabledOpenClaw Web ChatAccounts(config);
  if (accounts.length === 0) {
    log("[OpenClaw Web Chat] No enabled accounts found");
    return;
  }
  
  log(`[OpenClaw Web Chat] Starting monitor for ${accounts.length} account(s)`);
  
  await Promise.all(
    accounts.map((account) => monitorSingleAccount(account, opts))
  );
}
