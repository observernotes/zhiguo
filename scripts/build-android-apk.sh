#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_HOME="${ANDROID_HOME:-"$HOME/Library/Android/sdk"}"
BUILD_TOOLS_VERSION="${BUILD_TOOLS_VERSION:-35.0.0}"
PLATFORM_VERSION="${PLATFORM_VERSION:-android-35}"
BUILD_TOOLS="$ANDROID_HOME/build-tools/$BUILD_TOOLS_VERSION"
ANDROID_JAR="$ANDROID_HOME/platforms/$PLATFORM_VERSION/android.jar"
OUT_DIR="$ROOT_DIR/dist/android"
APK_OUT="$ROOT_DIR/dist/zhiguo-debug.apk"
KEYSTORE="$ROOT_DIR/android/debug.keystore"
JAVAC_BIN="${JAVAC_BIN:-javac}"
APP_URL="${ZHIGUO_APP_URL:-http://10.0.2.2:3300/}"

if [[ -n "${JAVA_HOME:-}" ]]; then
  JAVAC_BIN="$JAVA_HOME/bin/javac"
fi

for tool in "$BUILD_TOOLS/aapt2" "$BUILD_TOOLS/d8" "$BUILD_TOOLS/apksigner" "$BUILD_TOOLS/zipalign" "$JAVAC_BIN" "$ANDROID_JAR"; do
  if [[ ! -e "$tool" ]]; then
    echo "Missing Android build dependency: $tool" >&2
    exit 1
  fi
done

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/compiled" "$OUT_DIR/generated-res/values" "$OUT_DIR/gen" "$OUT_DIR/classes" "$OUT_DIR/dex" "$ROOT_DIR/dist"

escape_xml() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  printf "%s" "$value"
}

cat > "$OUT_DIR/generated-res/values/app_url.xml" <<APP_URL_XML
<resources>
    <string name="app_url">$(escape_xml "$APP_URL")</string>
</resources>
APP_URL_XML

"$BUILD_TOOLS/aapt2" compile --dir "$ROOT_DIR/android/res" -o "$OUT_DIR/compiled/resources.zip"
"$BUILD_TOOLS/aapt2" compile --dir "$OUT_DIR/generated-res" -o "$OUT_DIR/compiled/generated-resources.zip"
"$BUILD_TOOLS/aapt2" link \
  -I "$ANDROID_JAR" \
  --manifest "$ROOT_DIR/android/AndroidManifest.xml" \
  --java "$OUT_DIR/gen" \
  --min-sdk-version 23 \
  --target-sdk-version 35 \
  --version-code 1 \
  --version-name 0.1.0 \
  --auto-add-overlay \
  -o "$OUT_DIR/zhiguo-unsigned.apk" \
  "$OUT_DIR/compiled/resources.zip" \
  "$OUT_DIR/compiled/generated-resources.zip"

find "$ROOT_DIR/android/src" "$OUT_DIR/gen" -name "*.java" > "$OUT_DIR/sources.list"
"$JAVAC_BIN" -encoding UTF-8 -source 17 -target 17 -classpath "$ANDROID_JAR" -d "$OUT_DIR/classes" @"$OUT_DIR/sources.list"

CLASS_FILES=()
while IFS= read -r file; do
  CLASS_FILES+=("$file")
done < <(find "$OUT_DIR/classes" -name "*.class")

"$BUILD_TOOLS/d8" --release --min-api 23 --lib "$ANDROID_JAR" --output "$OUT_DIR/dex" "${CLASS_FILES[@]}"
(
  cd "$OUT_DIR/dex"
  zip -q "$OUT_DIR/zhiguo-unsigned.apk" classes.dex
)

"$BUILD_TOOLS/zipalign" -f -p 4 "$OUT_DIR/zhiguo-unsigned.apk" "$OUT_DIR/zhiguo-aligned.apk"

if [[ ! -f "$KEYSTORE" ]]; then
  keytool -genkeypair \
    -keystore "$KEYSTORE" \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -dname "CN=Zhiguo Debug,O=Zhiguo,C=CN" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000
fi

"$BUILD_TOOLS/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --out "$APK_OUT" \
  "$OUT_DIR/zhiguo-aligned.apk"

"$BUILD_TOOLS/apksigner" verify "$APK_OUT"
echo "$APK_OUT"
