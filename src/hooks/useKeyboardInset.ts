import { useEffect } from 'react';

/** Tracks virtual keyboard height for fixed layouts (iOS WebView / Capacitor). */
export function useKeyboardInset(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const update = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - viewport.height);
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
    };

    update();
    viewport.addEventListener('resize', update);

    return () => {
      viewport.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--keyboard-height');
    };
  }, [enabled]);
}
