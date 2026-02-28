import type { ClawdbotConfig, RuntimeEnv, ReplyPayload } from "openclaw/plugin-sdk";
import { getXiaoWuRuntime } from "./runtime.js";
import { sendMessageXiaoWu } from "./send.js";

export interface XiaoWuReplyDispatcherParams {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  senderId: string;
}

export function createXiaoWuReplyDispatcher(params: XiaoWuReplyDispatcherParams) {
  const { cfg, agentId, runtime, chatId, senderId } = params;
  const log = runtime?.log ?? console.log;
  
  log('[XiaoWu Reply] Creating reply dispatcher for chat: ' + chatId);
  
  const core = getXiaoWuRuntime();
  
  // 获取文本分片限制
  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg,
    channel: 'xiaowu',
    defaultLimit: 2000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, 'xiaowu');
  
  // 创建回复分发器
  const replyResult = core.channel.reply.createReplyDispatcherWithTyping({
    responsePrefix: undefined,
    responsePrefixContextProvider: undefined,
    humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
    deliver: async (payload: ReplyPayload) => {
      const text = payload.text ?? '';
      if (!text.trim()) {
        log('[XiaoWu Reply] Empty text, skipping');
        return;
      }
      
      log('[XiaoWu Reply] Delivering: ' + text.slice(0, 100));
      
      // 分片处理
      const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
      log('[XiaoWu Reply] Sending ' + chunks.length + ' chunks');
      
      for (const chunk of chunks) {
        try {
          const result = await sendMessageXiaoWu({
            cfg,
            to: 'chat:' + chatId,
            text: chunk,
          });
          
          if (result.error) {
            log('[XiaoWu Reply] Failed: ' + result.error);
            throw new Error(result.error);
          }
          
          log('[XiaoWu Reply] Success, messageId: ' + result.messageId);
        } catch (err) {
          log('[XiaoWu Reply] Error: ' + err);
          throw err;
        }
      }
    },
    onError: (err, info) => {
      log('[XiaoWu Reply] ' + info.kind + ' failed: ' + err);
    },
    onIdle: () => {
      log('[XiaoWu Reply] Dispatcher idle');
    },
  });
  
  log('[XiaoWu Reply] replyResult type: ' + typeof replyResult);
  log('[XiaoWu Reply] replyResult keys: ' + Object.keys(replyResult || {}).join(', '));
  
  const { dispatcher, replyOptions, markDispatchIdle } = replyResult || {};
  
  log('[XiaoWu Reply] replyOptions keys: ' + Object.keys(replyOptions || {}).join(', '));
  
  // 添加 reply 属性到 replyOptions
  const finalReplyOptions = {
    ...replyOptions,
    reply: dispatcher,
  };
  
  log('[XiaoWu Reply] finalReplyOptions keys: ' + Object.keys(finalReplyOptions || {}).join(', '));
  log('[XiaoWu Reply] finalReplyOptions.reply: ' + (finalReplyOptions?.reply ? 'exists' : 'missing'));
  
  return {
    dispatcher,
    replyOptions: finalReplyOptions,
    markDispatchIdle,
  };
}
