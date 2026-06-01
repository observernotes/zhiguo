import { Check, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { useProviderAuthStatus } from '../../provider-auth/hooks/useProviderAuthStatus';
import ProviderLoginModal from '../../provider-auth/view/ProviderLoginModal';
import { IS_CONSUMER_MODE, PRODUCT_NAME } from '../../../constants/product';
import { readErrorMessageFromResponse } from './utils';

type ConsumerOnboardingProps = {
  onComplete?: () => void | Promise<void>;
};

export default function ConsumerOnboarding({ onComplete }: ConsumerOnboardingProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showClaudeLogin, setShowClaudeLogin] = useState(false);
  const { providerAuthStatus, checkProviderAuthStatus, refreshProviderAuthStatuses } =
    useProviderAuthStatus();

  const claudeReady = Boolean(providerAuthStatus.claude?.authenticated);

  useEffect(() => {
    void refreshProviderAuthStatuses();
  }, [refreshProviderAuthStatuses]);

  const ensureGitDefaults = useCallback(async () => {
    const response = await authenticatedFetch('/api/user/git-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gitName: PRODUCT_NAME, gitEmail: 'user@local' }),
    });
    if (!response.ok) {
      const message = await readErrorMessageFromResponse(response, '初始化失败');
      throw new Error(message);
    }
  }, []);

  const handleFinish = async () => {
    if (!claudeReady) {
      setShowClaudeLogin(true);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await ensureGitDefaults();
      const response = await authenticatedFetch('/api/user/complete-onboarding', { method: 'POST' });
      if (!response.ok) {
        const message = await readErrorMessageFromResponse(response, '完成引导失败');
        throw new Error(message);
      }
      await onComplete?.();
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : '完成引导失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!IS_CONSUMER_MODE) {
    return null;
  }

  return (
    <>
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-lg">
          <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">
                {PRODUCT_NAME.slice(0, 1)}
              </div>
              <h1 className="text-2xl font-semibold text-foreground">欢迎使用{PRODUCT_NAME}</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                像日常聊天一样提问即可。{PRODUCT_NAME} 由 Claude 驱动，能帮你写作、学习、整理与处理各类任务。
              </p>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    claudeReady ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {claudeReady ? <Check className="h-3.5 w-3.5" /> : <span className="text-xs">1</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">连接 AI 助手</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {claudeReady
                      ? '已就绪，可以开始对话。'
                      : '需要先在本机完成 Claude 登录（管理员通常已配置好）。'}
                  </p>
                  {!claudeReady && (
                    <button
                      type="button"
                      onClick={() => setShowClaudeLogin(true)}
                      className="mt-3 text-sm font-medium text-primary hover:underline"
                    >
                      去连接
                    </button>
                  )}
                </div>
              </div>
            </div>

            {errorMessage && (
              <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                {errorMessage}
              </div>
            )}

            <button
              type="button"
              onClick={handleFinish}
              disabled={isSubmitting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在进入…
                </>
              ) : (
                '开始聊天'
              )}
            </button>
          </div>
        </div>
      </div>

      {showClaudeLogin && (
        <ProviderLoginModal
          isOpen={showClaudeLogin}
          onClose={() => setShowClaudeLogin(false)}
          provider="claude"
          onComplete={(exitCode) => {
            if (exitCode === 0) {
              void checkProviderAuthStatus('claude');
            }
          }}
        />
      )}
    </>
  );
}
