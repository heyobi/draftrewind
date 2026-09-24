# DraftRewind

**Never lose a draft. Rewind anytime.** — *Hiçbir taslağını kaybetme, istediğin an zamanı geri sar.*

DraftRewind quietly protects the folder of your thesis, homework or paper:

- **Automatic save points** — every change becomes a restore point; no "commit", no "push".
- **Unsaved-work rescue** — the unsaved contents of open Word/Excel documents are copied every few minutes (Windows).
- **Power-loss safe** — atomic writes and a journal that repairs history after a crash.
- **Time machine** — see what changed word by word, open or restore any older version.
- **Readable titles, offline** — save points get titles like *“Methods” section added (+120 words)*, generated locally; nothing is sent to an AI service.
- **Cloud without the hassle** — private GitHub backup and two-way Google Drive sync, both in the background, conflict-free (both versions are kept).
- **Phone app** — browse projects, history and documents, see colored diffs, a focus timer in the Dynamic Island.
- No Git installation required (uses [isomorphic-git](https://isomorphic-git.org/)).

## Get it

| Platform | Official (paid, supports development) | Free |
|---|---|---|
| Windows | Microsoft Store | GitHub Releases / build from source |
| iPhone | App Store | build from source |

## Build from source

```
npm install
npm start          # run the desktop app
npm run dist       # Windows installer in dist/
```

Mobile app: `mobile-expo/` (Expo SDK 57). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code: **GNU GPL v3.0 or later** — see [LICENSE](LICENSE).
The DraftRewind name, logo and icon are trademarks and are not licensed under the GPL — see [TRADEMARKS.md](TRADEMARKS.md).
Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

"Git" is a trademark of the Software Freedom Conservancy. DraftRewind is not affiliated with Git, GitHub or Google.
