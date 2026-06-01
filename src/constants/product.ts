import type { LLMProvider } from '../types/app';

/** 消费级「豆包式」产品模式：聊天优先、隐藏工程能力，底层仍为 Claude Code */
export const IS_CONSUMER_MODE = import.meta.env.VITE_CONSUMER_MODE === 'true';

export const PRODUCT_NAME =
  import.meta.env.VITE_PRODUCT_NAME || (IS_CONSUMER_MODE ? '智果' : 'CloudCLI');

export const DEFAULT_LOCALE =
  import.meta.env.VITE_DEFAULT_LOCALE || (IS_CONSUMER_MODE ? 'zh-CN' : 'en');

/** 消费模式下锁定的唯一 Agent 后端 */
export const LOCKED_PROVIDER: LLMProvider = 'claude';

/** 消费模式默认 Claude 模型（可通过 VITE_CONSUMER_CLAUDE_MODEL 覆盖） */
export const CONSUMER_DEFAULT_CLAUDE_MODEL =
  import.meta.env.VITE_CONSUMER_CLAUDE_MODEL || 'sonnet';

/** 智果吉祥物（GPT 生成的可爱小朋友头像） */
export const ZHIGUO_MASCOT_SRC = '/zhiguo-face-avatar.png';
