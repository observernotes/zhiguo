import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'
import { IS_CONSUMER_MODE, PRODUCT_NAME } from './constants/product.ts'

// Initialize i18n
import './i18n/config.js'

if (IS_CONSUMER_MODE) {
  document.documentElement.setAttribute('data-consumer', 'true')
  document.documentElement.lang = 'zh-CN'
  document.title = PRODUCT_NAME
}

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native-app-mode')
  document.body.classList.add('native-app-mode', 'pwa-mode')
  void import('@capacitor/status-bar').then(({ StatusBar, Style }) =>
    StatusBar.setOverlaysWebView({ overlay: false })
      .then(() => StatusBar.setBackgroundColor({ color: '#FFF7ED' }))
      .then(() => StatusBar.setStyle({ style: Style.Dark }))
      .catch((error) => console.warn('StatusBar init failed:', error)),
  )
}

// Register service worker for PWA + Web Push support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
