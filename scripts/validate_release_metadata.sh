#!/bin/sh

set -eu

CONFIG_PATH="${1:?config path is required}"
BUILD_CONFIGURATION="${2:?build configuration is required}"
PLACEHOLDER="__SET_BEFORE_RELEASE__"

read_plist_value() {
    key="$1"
    /usr/bin/plutil -extract "$key" raw -o - "$CONFIG_PATH" 2>/dev/null || true
}

privacy_url="$(read_plist_value PrivacyPolicyURL)"
support_url="$(read_plist_value SupportURL)"

if [ "$BUILD_CONFIGURATION" != "Release" ]; then
    exit 0
fi

if [ -z "$privacy_url" ] || [ -z "$support_url" ]; then
    echo "Release build blocked: privacy/support URL is empty." >&2
    exit 1
fi

if [ "$privacy_url" = "$PLACEHOLDER" ] || [ "$support_url" = "$PLACEHOLDER" ]; then
    echo "Release build blocked: AppConfig.plist still contains placeholder URLs." >&2
    exit 1
fi

case "$privacy_url" in
    http://*|https://*) ;;
    *)
        echo "Release build blocked: privacy policy URL must be http/https." >&2
        exit 1
        ;;
esac

case "$support_url" in
    http://*|https://*) ;;
    *)
        echo "Release build blocked: support URL must be http/https." >&2
        exit 1
        ;;
esac
