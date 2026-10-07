## Description
<!-- Briefly describe the changes introduced by this pull request -->

## Contributor Agreement (App Store & GPL Compatibility)
As stated in [CONTRIBUTING.md](../CONTRIBUTING.md), official DraftRewind binaries are distributed on the Apple App Store and the Microsoft Store. Because App Store terms are not fully compatible with pure GPL requirements, contributions must grant the necessary distribution permissions for official store builds:

- [ ] I confirm that my contribution is my own work (or I have the right to submit it), and I license it to the project under **GPL-3.0-or-later**.
- [ ] I grant the DraftRewind maintainers a perpetual, worldwide, non-exclusive, royalty-free license to distribute this contribution as part of official DraftRewind builds under additional terms (such as Apple App Store and Microsoft Store terms).
- [ ] I have signed off all commits (`git commit -s`) to certify the [Developer Certificate of Origin (DCO)](https://developercertificate.org/).

## Checklist
- [ ] If modifying `mobile-expo`, ran `npx expo-doctor` and `npx expo prebuild --platform ios --clean` without errors.
- [ ] Maintained Apple Privacy Manifest (`privacyManifests`) and permission descriptions integrity.
- [ ] Tests pass (`npm test`).
