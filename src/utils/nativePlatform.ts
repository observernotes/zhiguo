import { Capacitor } from '@capacitor/core';

export function isNativeAppPlatform(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Capacitor.isNativePlatform();
}

export function isAndroidNative(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Capacitor.getPlatform() === 'android';
}

export function isIosNative(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Capacitor.getPlatform() === 'ios';
}
