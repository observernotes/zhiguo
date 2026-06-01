#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/_paths.sh"
APK_NAME="${APK_NAME:-zhiguo-debug.apk}"

cd "$ROOT"

echo "==> Web build"
npm run build

if [[ ! -d android ]]; then
  echo "==> Init Capacitor Android"
  npx cap add android
fi

echo "==> Capacitor sync"
npx cap sync android

echo "==> Gradle assembleDebug"
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
cd android
./gradlew assembleDebug

mkdir -p "$RELEASE_DIR"
cp -f app/build/outputs/apk/debug/app-debug.apk "$RELEASE_DIR/$APK_NAME"

echo "APK: $RELEASE_DIR/$APK_NAME"
