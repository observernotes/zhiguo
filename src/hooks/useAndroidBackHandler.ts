import { useEffect, useRef } from 'react';

import { isAndroidNative } from '../utils/nativePlatform';

export type AndroidBackHandlerState = {
  showSettings: boolean;
  sidebarOpen: boolean;
  hasSessionRoute: boolean;
  onCloseSettings: () => void;
  onCloseSidebar: () => void;
  onNavigateHome: () => void;
};

/**
 * Android hardware back: Settings → Sidebar → leave session → exit app.
 * Registering a listener replaces WebView default back behavior.
 */
export function useAndroidBackHandler(state: AndroidBackHandlerState) {
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!isAndroidNative()) {
      return;
    }

    let removed = false;
    let handle: { remove: () => Promise<void> } | null = null;

    void import('@capacitor/app').then(({ App }) => {
      if (removed) {
        return;
      }

      void App.addListener('backButton', () => {
        const current = stateRef.current;

        if (current.showSettings) {
          current.onCloseSettings();
          return;
        }

        if (current.sidebarOpen) {
          current.onCloseSidebar();
          return;
        }

        if (current.hasSessionRoute) {
          current.onNavigateHome();
          return;
        }

        void App.exitApp();
      }).then((listener) => {
        handle = listener;
      });
    });

    return () => {
      removed = true;
      void handle?.remove();
    };
  }, []);
}
