#!/bin/sh

set -eu

CONFIG_PATH="${1:?config path is required}"
BUILD_CONFIGURATION="${2:?build configuration is required}"
STAMP_PATH="${3:-}"
PLACEHOLDER="__SET_BEFORE_RELEASE__"

read_plist_value() {
    key="$1"
    /usr/bin/plutil -extract "$key" raw -o - "$CONFIG_PATH" 2>/dev/null || true
}

require_release_url() {
    label="$1"
    value="$2"

    if [ -z "$value" ]; then
        echo "Release build blocked: ${label} URL is empty." >&2
        exit 1
    fi

    if [ "$value" = "$PLACEHOLDER" ]; then
        echo "Release build blocked: ${label} URL still uses the placeholder value." >&2
        exit 1
    fi

    case "$value" in
        http://*|https://*) ;;
        *)
            echo "Release build blocked: ${label} URL must be http/https." >&2
            exit 1
            ;;
    esac
}

privacy_url="$(read_plist_value PrivacyPolicyURL)"
support_url="$(read_plist_value SupportURL)"

if [ "$BUILD_CONFIGURATION" != "Release" ]; then
    exit 0
fi

require_release_url "privacy policy" "$privacy_url"
require_release_url "support" "$support_url"

if [ -n "$STAMP_PATH" ]; then
    mkdir -p "$(dirname "$STAMP_PATH")"
    : > "$STAMP_PATH"
fi
