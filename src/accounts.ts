/**
 * XiaoWu 账号管理
 */

import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { ResolvedXiaoWuAccount, XiaoWuConfig } from "./types.js";

const DEFAULT_ACCOUNT_ID = "default";

/**
 * 解析 XiaoWu 账号配置
 */
export function resolveXiaoWuAccount({
  cfg,
  accountId = DEFAULT_ACCOUNT_ID,
}: {
  cfg: ClawdbotConfig;
  accountId?: string;
}): ResolvedXiaoWuAccount {
  const channelConfig = cfg.channels?.xiaowu as XiaoWuConfig | undefined;
  const accounts = channelConfig?.accounts as
    | Record<string, XiaoWuConfig>
    | undefined;

  // 获取指定账号或默认配置
  const accountConfig =
    accountId === DEFAULT_ACCOUNT_ID
      ? channelConfig
      : accounts?.[accountId];

  const isDefault = accountId === DEFAULT_ACCOUNT_ID;
  
  // 判断是否使用 Ruyuan 适配器
  const adapter = accountConfig?.adapter || 
    (accountConfig?.ruyuan?.userId ? "ruyuan" : "xiaowu");

  return {
    accountId,
    enabled: Boolean(
      isDefault
        ? channelConfig?.enabled
        : accounts?.[accountId]?.enabled ?? channelConfig?.enabled
    ),
    configured: Boolean(
      accountConfig?.wsUrl || accountConfig?.apiUrl
    ),
    config: accountConfig || {},
    wsUrl: accountConfig?.wsUrl || "ws://localhost:8080/ws",
    apiUrl: accountConfig?.apiUrl || "http://localhost:8080",
    apiToken: accountConfig?.apiToken,
    connectionMode: accountConfig?.connectionMode || "websocket",
    pollInterval: accountConfig?.pollInterval || 3000,
    autoReconnect: accountConfig?.autoReconnect ?? true,
    adapter: adapter as "xiaowu" | "ruyuan",
    ruyuan: accountConfig?.ruyuan,
  };
}

/**
 * 列出所有账号ID
 */
export function listXiaoWuAccountIds(cfg: ClawdbotConfig): string[] {
  const channelConfig = cfg.channels?.xiaowu as XiaoWuConfig | undefined;
  const accounts = channelConfig?.accounts as
    | Record<string, XiaoWuConfig>
    | undefined;

  const ids = [DEFAULT_ACCOUNT_ID];
  if (accounts) {
    ids.push(...Object.keys(accounts));
  }
  return ids;
}

/**
 * 获取默认账号ID
 */
export function resolveDefaultXiaoWuAccountId(
  cfg: ClawdbotConfig
): string | undefined {
  const channelConfig = cfg.channels?.xiaowu as XiaoWuConfig | undefined;
  if (!channelConfig?.enabled && !channelConfig?.accounts) {
    return undefined;
  }
  return DEFAULT_ACCOUNT_ID;
}

/**
 * 列出启用的账号
 */
export function listEnabledXiaoWuAccounts(
  cfg: ClawdbotConfig
): ResolvedXiaoWuAccount[] {
  const ids = listXiaoWuAccountIds(cfg);
  return ids
    .map((id) => resolveXiaoWuAccount({ cfg, accountId: id }))
    .filter((acc) => acc.enabled && acc.configured);
}
