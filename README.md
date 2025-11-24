## CleanX

Personal userscript (and Chrome extension) for X/Twitter that filters posts by country, region, or language with optional highlighting.

### Features
- Add or remove blocked countries, regions, and language scripts (no defaults).
- Choose filter behavior: hide or highlight matches (red border/background). Region-only accounts can be highlighted in yellow.
- Per-session and lifetime counts persisted to IndexedDB; exports available from the UI.
- Fetches profile “About” data to detect country/region and username change counts.
- Settings button in the left nav (🚫 icon) opens the modal for edits.

### Images

Sidebar Menu:
<img width="425" height="1391" alt="image" src="https://github.com/user-attachments/assets/ac24a7d2-a08c-4705-9252-bb344b3760c5" />


Settings Menu:
<img width="845" height="1476" alt="image" src="https://github.com/user-attachments/assets/b4f4780e-39a7-4c0f-a4ac-5136b41cbc34" />


Shows all user's countries in posts:
<img width="1078" height="566" alt="image" src="https://github.com/user-attachments/assets/cd3e2e41-953c-4957-9d6b-fc8ca2c27d66" />


### Usage
1) Userscript: download `CleanX.user.js` from Releases (or use `CleanX-user.js` in this repo) and install it in your userscript manager (Tampermonkey/Greasemonkey).  
2) Chrome extension: download `CleanX-extension.zip` from Releases and load as an unpacked extension in `chrome://extensions` (Developer Mode), or load the `extension/` folder directly.  
3) Open X/Twitter and click the 🚫 CleanX button under Profile in the left nav.  
4) Add countries/regions/languages; toggle block vs highlight and region-only highlight.  
5) Reload to apply; use Export DB for debugging or backup.

### Development Notes
- No build step; edit `CleanX-user.js` directly.
- Optional format: `npx prettier --check "CleanX-user.js"`.
- Primary storage: `localStorage` + IndexedDB (`known` store for users, `stats` for totals).
- Extension entrypoint: `extension/content.js`, manifest at `extension/manifest.json`.
- CI: pushes to `main`/`master` build artifacts (userscript, zipped extension, changelog) as workflow artifacts. Tagging `v*` publishes a GitHub Release with those files attached and the changelog as the release body.
