# Inbox: agreed future work

Work that was agreed but not done. One line per item, newest at the bottom. Strike an item
through when it ships, with the date; do not delete it, so the history stays readable.

## sm-google-workspace

- [ ] More canned commands, in the spirit of `/gdrive-root` and `/inbox-new` — today's calendar,
      recent documents, unread from one sender, Drive search by name. Each one is a fixed
      `gog` call in `src/gog.ts` plus a command registration, so it costs no tokens.
      Home: `~/pi-agents-experts-grouped/gog-workspace-agents/sm-google-workspace/sm-google-workspace`.
- [ ] `--limit N` on the list-shaped canned commands (start with `/inbox-new`), so a busy inbox
      does not print forty rows. Same place.
- [x] ~~Confirm the keyring passphrase in that repo's `.env` is the current one; it was carried
      over from `~/archived-pi-agents-experts/gog-worksapce-agents/sm-google-workspace/.env`.~~
      Confirmed 2026-11-01: the repo keeps its own `.env` (mode 600, gitignored) with
      `GOG_ACCOUNT` and `GOG_KEYRING_PASSWORD`, and `gog` answers through the launcher.

## This agent

- [ ] `gpt-6.1-sol` is enabled in `settings.json` with no `OPENAI_API_KEY` in `.env`, so every
      launch prints `No models match pattern "gpt-6.1-sol"`. Waiting on the key, then re-check
      whether the sibling's `settings.json` should get the model back too.

## Group rename, left open

- [x] ~~The GitHub repository is still `neopmpmtj/gog-worksapce-agents`, because the local
      folder was renamed and the remote was not.~~ Renamed on GitHub 2026-11-01. The `url` in
      `~/pi-agents-experts-grouped/.gitmodules`, the parent's `.git/config` and the submodule's
      own `origin` all point at `gog-workspace-agents.git` now.
- [ ] `~/archived-pi-agents-experts/gog-worksapce-agents` keeps the old spelling: it is a
      separate archived tree and was not part of this rename.
