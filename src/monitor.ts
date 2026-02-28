/**
 * XiaoWu Monitor - 借鉴 Feishu Plugin 最佳实践
 * 
 * 消息监听和 Agent 触发
 */

import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import { resolveXiaoWuAccount, listEnabledXiaoWuAccounts } from "./accounts.js";
import { registerMessageHandler, closeWSConnection, pollXiaoWuMessages } from "./client.js";
import { getXiaoWuChannel } from "./runtime.js";
import { sendMessageXiaoWu } from "./send.js";
import type { ResolvedXiaoWuAccount, XiaoWuMessageEvent } from "./types.js";

export interface MonitorXiaoWuOpts {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
}

async function monitorSingleAccount(
  account: ResolvedXiaoWuAccount,
  opts: MonitorXiaoWuOpts
): Promise<void> {
  const { config, runtime, abortSignal } = opts;
  const log = runtime?.log ?? console.log;
  const { accountId, connectionMode } = account;
  
  log(`[XiaoWu ${accountId}] Starting monitor (mode: ${connectionMode})...`);
  
  const chatHistories = new Map<string, HistoryEntry[]>();
  
  if (connectionMode === "websocket") {
    return monitorWebSocket(account, opts, chatHistories);
  } else {
    return monitorHTTP(account, opts, chatHistories);
  }
}

async function monitorWebSocket(
  account: ResolvedXiaoWuAccount,
  opts: MonitorXiaoWuOpts,
  chatHistories: Map<string, HistoryEntry[]>
): Promise<void> {
  const { config, runtime, abortSignal } = opts;
  const log = runtime?.log ?? console.log;
  const { accountId } = account;
  
  return new Promise((resolve) => {
    const handleMessage = async (event: XiaoWuMessageEvent) => {
      try {
        log(`[XiaoWu ${accountId}] Processing message from ${event.senderName}`);
        
        // 获取 Core Channel API
        const core = getXiaoWuChannel();
        const isGroup = !event.isDirect;
        
        // 解析路由
        const route = core.routing.resolveAgentRoute({
          cfg: config,
          channel: "xiaowu",
          peer: { kind: isGroup ? "group" : "dm", id: isGroup ? event.chatId : event.senderId },
        });
        
        log(`[XiaoWu ${accountId}] Routed to agent: ${route.sessionKey}`);
        
        // 创建 deliver 函数 - 发送回复到 Web 聊天室
        const deliver = async (payload: any) => {
          const text = payload.text ?? "";
          if (!text.trim()) return;
          
          log(`[XiaoWu ${accountId}] Delivering: ${text.slice(0, 50)}...`);
          
          try {
            const result = await sendMessageXiaoWu({
              cfg: config!,
              to: `chat:${event.chatId}`,
              text: text,
              replyTo: event.messageId,
            });
            
            if (result.error) {
              log(`[XiaoWu ${accountId}] Send failed: ${result.error}`);
            } else {
              log(`[XiaoWu ${accountId}] Send success: ${result.messageId}`);
            }
          } catch (err) {
            log(`[XiaoWu ${accountId}] Send error: ${err}`);
          }
        };
        
        // 创建回复分发器
        const replyResult = core.reply.createReplyDispatcherWithTyping({
          deliver,
          onError: (err: Error, info: any) => {
            log(`[XiaoWu ${accountId}] deliver error: ${err}`);
          },
          onIdle: () => {
            log(`[XiaoWu ${accountId}] dispatcher idle`);
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
          channel: "XiaoWu",
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
          Provider: "xiaowu" as const,
          Surface: "xiaowu" as const,
          MessageSid: event.messageId,
          Timestamp: Date.now(),
          WasMentioned: true,
          CommandAuthorized: true,
          OriginatingChannel: "xiaowu" as const,
          OriginatingTo: `chat:${event.chatId}`,
        });
        
        log(`[XiaoWu ${accountId}] Dispatching to agent...`);
        
        // 关键：调用 dispatchReplyFromConfig 触发 Agent
        const { queuedFinal, counts } = await core.reply.dispatchReplyFromConfig({
          ctx: ctxPayload,
          cfg: config,
          dispatcher,
          replyOptions: finalReplyOptions,
        });
        
        markDispatchIdle();
        
        log(`[XiaoWu ${accountId}] Dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
        
        // 保存历史
        const historyKey = `${accountId}:${event.chatId}`;
        const history = chatHistories.get(historyKey) || [];
        history.push({ role: "user", content: event.content, timestamp: event.timestamp });
        chatHistories.set(historyKey, history);
      } catch (err) {
        log(`[XiaoWu ${accountId}] Error handling message: ${err}`);
      }
    };
    
    // 注册消息处理器
    const cleanup = registerMessageHandler(accountId, account.config, handleMessage);
    
    // 处理终止
    const handleAbort = () => {
      log(`[XiaoWu ${accountId}] Abort signal received, stopping`);
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
  account: ResolvedXiaoWuAccount,
  opts: MonitorXiaoWuOpts,
  chatHistories: Map<string, HistoryEntry[]>
): Promise<void> {
  const { runtime } = opts;
  const log = runtime?.log ?? console.log;
  log("[XiaoWu] HTTP polling not fully implemented");
}

export async function monitorXiaoWuProvider(
  opts: MonitorXiaoWuOpts = {}
): Promise<void> {
  const { config, runtime, accountId } = opts;
  const log = runtime?.log ?? console.log;
  
  if (!config) {
    throw new Error("Config is required for XiaoWu monitor");
  }
  
  if (accountId) {
    const account = resolveXiaoWuAccount({ cfg: config, accountId });
    if (!account.enabled || !account.configured) {
      throw new Error(`XiaoWu account "${accountId}" not configured or disabled`);
    }
    return monitorSingleAccount(account, opts);
  }
  
  const accounts = listEnabledXiaoWuAccounts(config);
  if (accounts.length === 0) {
    log("[XiaoWu] No enabled accounts found");
    return;
  }
  
  log(`[XiaoWu] Starting monitor for ${accounts.length} account(s)`);
  
  await Promise.all(
    accounts.map((account) => monitorSingleAccount(account, opts))
  );
}
