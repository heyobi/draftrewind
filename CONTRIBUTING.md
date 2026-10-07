# Contributing to DraftRewind

Thanks for helping! DraftRewind is licensed under **GPL-3.0-or-later**.

## Why there is a contributor agreement

The official DraftRewind builds and services are distributed across various platforms and
digital storefronts (including the Apple App Store, Google Play Store, Microsoft Store, and
other app stores, marketplaces, or direct distribution channels). Because proprietary app store
and commercial distribution terms are not fully compatible with pure GPL requirements, the
maintainers must have the legal right to distribute, monetize, and package contributed code in
official builds under store and platform terms as well.

By opening a pull request you agree that:

1. Your contribution is your own work (or you have the legal right to submit it), and
   you license it to the project under **GPL-3.0-or-later**.
2. You additionally grant the DraftRewind maintainers a perpetual, irrevocable, worldwide,
   transferable, sub-licensable, royalty-free license to use, reproduce, modify, compile,
   publish, monetize, and distribute your contribution (as source code, binaries, or services)
   as part of official DraftRewind releases across any platforms, distribution channels,
   and app stores (including Apple App Store, Google Play Store, Microsoft Store, and any other
   marketplaces) under any terms chosen by the maintainers.
3. You sign off each commit (`git commit -s`) to certify the
   [Developer Certificate of Origin](https://developercertificate.org/).

Your contribution always stays available to everyone in this repository under the GPL.

## Development

Desktop (Electron):

```
npm install
npm start
```

Windows installer: `npm run dist` (output in `dist/`).

Mobile (Expo, iOS): see `mobile-expo/`. The iOS IPA is built by GitHub Actions
(`mobile-expo/.github/workflows/build-ios.yml`).

OAuth: create your own GitHub OAuth App (device flow enabled) and Google Cloud
OAuth clients (Desktop + iOS). Put the desktop Google credentials in
`app/core/google-oauth.json` (git-ignored) — see `app/core/config.js`.
