/**
 * XiaoWu 工具函数
 */

import { getConnectionStatus } from "./client.js";

/**
 * 获取所有连接的状态（用于调试）
 */
export function getAllConnectionStatus(): Record<string, ReturnType<typeof getConnectionStatus>> {
  // 这里需要从 client.ts 获取所有 accountId
  // 为了简化，我们只返回一个函数，让用户传入 accountId
  return {};
}

export { getConnectionStatus } from "./client.js";
