import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../utils/api';

export function useZhiguoBootstrap(enabled: boolean) {
  const [ready, setReady] = useState(!enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await authenticatedFetch('/api/user/ensure-workspace', {
          method: 'POST',
        });
        if (!response.ok) {
          throw new Error('工作区初始化失败');
        }
        if (!cancelled) {
          setReady(true);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : '初始化失败');
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { ready, error };
}
