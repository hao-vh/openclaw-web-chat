import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { sendMessageXiaoWu } from "./send.js";

export const xiaowuOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => {
    // 简单分片：按段落分割
    if (text.length <= limit) return [text];
    const chunks: string[] = [];
    let current = "";
    for (const line of text.split("\n")) {
      if ((current + line).length > limit && current) {
        chunks.push(current);
        current = line;
      } else {
        current += (current ? "\n" : "") + line;
      }
    }
    if (current) chunks.push(current);
    return chunks.length ? chunks : [text.slice(0, limit)];
  },
  chunkerMode: "text",
  textChunkLimit: 2000,
  sendText: async ({ cfg, to, text }) => {
    console.log("[XiaoWu Outbound] Sending text to " + to + ": " + text.slice(0, 100));
    const result = await sendMessageXiaoWu({ cfg, to, text });
    console.log("[XiaoWu Outbound] Result: " + JSON.stringify(result));
    return { channel: "xiaowu", ...result };
  },
  sendMedia: async ({ cfg, to, text }) => {
    // 暂时只支持文本
    if (text?.trim()) {
      const result = await sendMessageXiaoWu({ cfg, to, text });
      return { channel: "xiaowu", ...result };
    }
    return { channel: "xiaowu", success: false, error: "No content to send" };
  },
};
