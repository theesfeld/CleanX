# CleanX

<img width="820" height="1258" alt="image" src="https://github.com/user-attachments/assets/21a051b7-4b76-4d26-9e5b-a19427169cf0" />


CleanX helps you clean your x.com feed by blocking or hiding accounts based on their account creation country and/or languages. It's a lightweight, client-side tool intended to run in your browser (userscript or unpacked extension) and filter feed items before they reach your eyes.

- Repository: theesfeld/CleanX
- Description: Clean your x.com feed - block by the account creation country and/or languages

Features
- Block or hide posts from accounts created in specified countries (ISO 3166-1 alpha-2 codes).
- Block or hide posts from accounts that use specified languages (ISO 639-1 codes).
- Configurable behavior (block, hide, or mark).
- Runs locally in your browser — no server component, no account access required.

Table of contents
- Installation
  - Userscript (Tampermonkey / Greasemonkey)
  - Browser extension (unpacked)
- Usage
  - Configuration file (example)
  - Examples
- Development
- Troubleshooting
- Contributing
- License

Installation

Userscript (recommended, easiest)
1. Install a userscript manager:
   - Tampermonkey (Chrome, Edge, Brave, Safari) — https://www.tampermonkey.net
   - Greasemonkey (Firefox) — https://addons.mozilla.org/firefox/addon/greasemonkey/
2. Install the CleanX userscript:
   - If this repository includes a userscript file (for example `cleanx.user.js`), open its raw URL in the browser and choose "Install" in Tampermonkey/Greasemonkey.
   - Example (replace with actual raw URL in your repo): `https://raw.githubusercontent.com/theesfeld/CleanX/main/cleanx.user.js`
3. Open the userscript manager dashboard and edit settings if needed.

Browser extension (unpacked) — for development or if the repo provides a WebExtension build
1. Clone the repository:
   git clone https://github.com/theesfeld/CleanX.git
2. Install dependencies and build (if the repository provides build scripts):
   npm install
   npm run build
3. Load the extension in your browser:
   - Chrome / Edge: go to chrome://extensions, enable "Developer mode", click "Load unpacked", and select the extension build directory (e.g., `dist/` or the repository root as appropriate).
   - Firefox: go to about:debugging#/runtime/this-firefox and choose "Load Temporary Add-on" and pick the extension manifest (manifest.json).
4. Configure the extension from its options page (if provided) or by editing the config file in the extension directory.

Usage

How it works
- CleanX examines each feed item as it is loaded in the browser and uses available account metadata (account creation country and posted languages) to decide whether to hide or mark the item.
- All filtering is performed locally in your browser. No timeline data is sent to external servers.

Configuration
- CleanX uses a JSON-based settings object. Where you put the settings depends on how you installed CleanX:
  - Userscript: open the userscript settings (Tampermonkey) or edit a `config` object in the script.
  - Extension: open the options page or edit the extension's `config.json` (if provided).
- Example configuration (replace with your chosen codes):

```json
{
  "mode": "hide",
  "blockedCountries": ["CN", "RU", "IR"],
  "blockedLanguages": ["zh", "ru"],
  "whitelistAccounts": ["friend_handle", "trusted_account"],
  "logMatches": false
}
```

Configuration fields
- mode: "hide" (remove matching posts from feed), "block" (attempt to block user accounts if supported), or "mark" (add a visible label to matching posts).
- blockedCountries: Array of ISO 3166-1 alpha-2 country codes. Accounts created in any of these countries will be filtered.
- blockedLanguages: Array of ISO 639-1 language codes. Posts detected as these languages will be filtered.
- whitelistAccounts: Array of account handles to always allow.
- logMatches: boolean; if true, the script logs details about matched items to the console (useful for tuning your configuration).

Examples

1) Hide posts from accounts created in China or Russia, and posts in Chinese or Russian:
```json
{
  "mode": "hide",
  "blockedCountries": ["CN", "RU"],
  "blockedLanguages": ["zh", "ru"]
}
```

2) Mark (don't hide) posts in Spanish, but allow accounts from Argentina:
```json
{
  "mode": "mark",
  "blockedCountries": [],
  "blockedLanguages": ["es"],
  "whitelistAccounts": ["arg_friend"]
}
```

Notes and tips
- Country detection relies on account metadata (if the platform exposes creation country). Depending on the platform API or page markup, accuracy may vary.
- Language detection may use heuristics (e.g., text language detection) — short posts can be ambiguous.
- Use console logging while tuning the configuration to ensure the filters match what you expect.

Development

Set up
1. Clone the repo:
   git clone https://github.com/theesfeld/CleanX.git
   cd CleanX
2. Install dependencies:
   npm install

Common commands (project-specific commands may vary — update these to match package.json scripts)
- Start a development watch (hot reload): npm run dev
- Build for production: npm run build
- Run linting: npm run lint
- Run tests: npm test

Load the code in your browser as an unpacked extension (see Installation) to iterate quickly during development.

Troubleshooting
- Filters not applied: open Developer Tools → Console and look for CleanX logs or errors. Ensure the userscript/extension is enabled on x.com and related domains.
- No account country data: some pages may not expose account metadata. Try letting the extension run on more pages or consider enabling language-only filtering.
- Build problems: make sure Node.js and npm are installed and up to date.

Contributing
Contributions are welcome! A suggested flow:
1. Open an issue to discuss major changes or feature requests.
2. Create a branch for your work: git checkout -b feat/your-feature
3. Implement changes, add/update tests, and update README/docs.
4. Open a pull request describing the change.

Please follow the repository's code style and include tests for behavior changes.

License
This project is provided under the MIT License. See the LICENSE file for details.

Acknowledgements
- Built for people who want more control over their x.com feed by filtering content locally in the browser.

If you'd like, I can:
- Add badge(s) (build / license).
- Generate a smaller README variant for display on GitHub (shorter / with screenshots).
- Create a template config file (config.example.json) in the repo.
