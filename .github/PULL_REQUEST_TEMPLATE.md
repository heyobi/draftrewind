## Description
<!-- Briefly describe the changes introduced by this pull request -->

## Contributor Agreement (Multi-Store & GPL Compatibility)
As stated in [CONTRIBUTING.md](../CONTRIBUTING.md), official DraftRewind binaries and services are distributed across multiple platforms and storefronts (Apple App Store, Google Play Store, Microsoft Store, and other channels). Because store and proprietary distribution terms are not fully compatible with pure GPL requirements, contributions must grant the necessary distribution permissions for official builds:

- [ ] I confirm that my contribution is my own work (or I have the legal right to submit it), and I license it to the project under **GPL-3.0-or-later**.
- [ ] I grant the DraftRewind maintainers a perpetual, irrevocable, worldwide, transferable, sub-licensable, royalty-free license to use, compile, publish, monetize, and distribute this contribution as part of official DraftRewind releases across any platforms, distribution channels, and app stores (including Apple App Store, Google Play Store, Microsoft Store, and other marketplaces) under any terms chosen by the maintainers.
- [ ] I have signed off all commits (`git commit -s`) to certify the [Developer Certificate of Origin (DCO)](https://developercertificate.org/).

## Checklist
- [ ] If modifying `mobile-expo`, ran `npx expo-doctor` and `npx expo prebuild --platform ios --clean` without errors.
- [ ] Maintained Apple Privacy Manifest (`privacyManifests`) and permission descriptions integrity.
- [ ] Tests pass (`npm test`).
