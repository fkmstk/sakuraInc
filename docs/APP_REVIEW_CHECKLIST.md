# App Store Review Checklist (JP first release)

## Release gate
- [ ] Third-party permission proof is stored and shareable.
- [ ] If permission proof is missing, submission is blocked.

## Legal and metadata
- [ ] App name and description avoid direct third-party trademark emphasis.
- [ ] Privacy policy URL is active.
- [ ] Support URL is active.
- [ ] App Review Notes updated for current implementation.

## Privacy and data use
- [ ] Sent data is limited to product ASIN.
- [ ] No tracking SDK / ad SDK is included.
- [ ] No user login is required.

## Extension permission policy
- [ ] `host_permissions` remain limited to `*.sakura-checker.jp`.
- [ ] `permissions` remain minimal (`nativeMessaging` only).
- [ ] Any permission change requires App Review Notes update before release.

## QA and regression
- [ ] Known ASIN regression table executed.
- [ ] Product page layout checks completed on iOS and iPadOS.
- [ ] Failure mode still keeps "open source page" navigation.
