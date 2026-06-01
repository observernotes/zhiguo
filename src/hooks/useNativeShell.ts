import { useEffect } from 'react';

import { isNativeAppPlatform } from '../utils/nativePlatform';
import { useKeyboardInset } from './useKeyboardInset';

type UseNativeShellOptions = {
  /** Enable keyboard inset tracking (recommended for chat apps). */
  trackKeyboard?: boolean;
  /** Treat installed PWA like a native shell (safe areas + layout). */
  isInstalledShell?: boolean;
};

/** Keyboard inset + PWA shell class (native shell class is set in main.jsx). */
export function useNativeShell(options: UseNativeShellOptions = {}) {
  const { trackKeyboard = true, isInstalledShell = false } = options;
  const shellActive = isNativeAppPlatform() || isInstalledShell;

  useKeyboardInset(trackKeyboard && shellActive);

  useEffect(() => {
    if (!isInstalledShell || isNativeAppPlatform()) {
      return;
    }

    document.body.classList.add('pwa-mode');

    return () => {
      document.body.classList.remove('pwa-mode');
    };
  }, [isInstalledShell]);
}
