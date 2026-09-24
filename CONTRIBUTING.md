# Contributing to DraftRewind

Thanks for helping! DraftRewind is licensed under **GPL-3.0-or-later**.

## Why there is a contributor agreement

The official DraftRewind builds are sold on the Apple App Store and the Microsoft
Store (the same code is free on GitHub). App Store terms are not fully compatible
with the GPL, so the maintainers must be able to distribute contributed code in
store builds under store terms as well.

By opening a pull request you agree that:

1. Your contribution is your own work (or you have the right to submit it), and
   you license it to the project under GPL-3.0-or-later.
2. You additionally grant the DraftRewind maintainers a perpetual, worldwide,
   non-exclusive, royalty-free license to distribute your contribution as part of
   official DraftRewind builds under other terms (e.g. app store terms).
3. You sign off each commit (`git commit -s`) to certify the
   [Developer Certificate of Origin](https://developercertificate.org/).

Your contribution always stays available to everyone under the GPL.

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
