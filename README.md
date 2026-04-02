# sakuraInc

Safari Web Extension app that shows Sakura Checker reference information on supported product pages in Safari.

## What it does
- Extracts an ASIN from a supported product detail page.
- Fetches the corresponding Sakura Checker result through the native host bridge.
- Shows score, risk label, and a fallback link to the source page.

## Repository layout
- `sakuraInc/`: iOS container app and release metadata.
- `sakuraInc Extension/`: Safari Web Extension resources and native extension bridge.
- `tests/`: Node-based regression tests for extension resources.
- `docs/`: release, privacy, and App Review support documents.
- `scripts/validate_release_metadata.sh`: blocks Release builds when required URLs are missing.

## Local verification
Run the resource-level regression tests:

```sh
node --test tests/*.cjs
```

Run a Release build without code signing:

```sh
xcodebuild \
  -project sakuraInc.xcodeproj \
  -scheme sakuraInc \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO \
  -derivedDataPath ./build \
  build
```

## Release checklist
- Update `docs/APP_REVIEW_CHECKLIST.md` for the current release pass.
- Keep `sakuraInc/Resources/AppConfig.plist` pointing at live privacy/support URLs.
- Refresh `docs/APP_REVIEW_NOTES.md` if permissions or data flow change.
- Re-run `node --test tests/*.cjs` and the Release build before shipping.

