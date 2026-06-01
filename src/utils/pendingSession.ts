import type { LLMProvider } from '../types/app';

export const PENDING_SESSION_PREFIX = 'pending-';

export function createPendingSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${PENDING_SESSION_PREFIX}${crypto.randomUUID()}`;
  }
  return `${PENDING_SESSION_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isPendingSessionId(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId && String(sessionId).startsWith(PENDING_SESSION_PREFIX));
}

export function buildOptimisticSessionSummary(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return '新对话';
  }
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed;
}

export function resolveProviderSessionListKey(provider: LLMProvider): 'sessions' | 'cursorSessions' | 'codexSessions' | 'geminiSessions' | 'opencodeSessions' {
  switch (provider) {
    case 'cursor':
      return 'cursorSessions';
    case 'codex':
      return 'codexSessions';
    case 'gemini':
      return 'geminiSessions';
    case 'opencode':
      return 'opencodeSessions';
    default:
      return 'sessions';
  }
}
