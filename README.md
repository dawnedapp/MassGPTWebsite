# GPT Mass Deleter

Internal Chrome extension and backend for bulk deleting and archiving ChatGPT conversations.

## Summary

This project includes:

- Extension UI for bulk chat actions
- Login/register flow with JWT auth
- Per-user delete tracking and daily limits
- MongoDB-backed persistence
- Stripe support for Pro access

## Main Parts

- `content.js` - page integration and UI injection
- `ui.js` - toolbar, settings, login modal, counters
- `engine.js` - bulk action execution
- `styles.css` - extension styling
- `manifest.json` - Chrome extension manifest
- `backend/` - Flask API, data models, billing hooks

## Notes

- JWT tokens are stored in `chrome.storage.local`
- Free accounts are limited to 10 deletes per day
- Pro accounts are unlimited
- Backend and deployment details are maintained separately

## Status

Active development project.
