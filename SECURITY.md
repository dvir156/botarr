# Security

## Supported versions

Security fixes are applied to the latest release on the default branch. Use an up-to-date checkout.

## Reporting a vulnerability

Please report security issues **privately** instead of using public GitHub issues, so we can coordinate a fix before details are public.

1. Open a **private security advisory** on GitHub (repository **Security** tab → **Report a vulnerability**), or  
2. Contact the maintainers with a clear description, affected component, and steps to reproduce.

We will acknowledge receipt and work on a timeline for a patch and disclosure.

## Notes for operators

- This bot is designed for a **small, trusted set of users** identified by `TELEGRAM_ALLOWED_USER_IDS`. Anyone on that list can trigger LLM and *arr API usage; do not expose the bot to untrusted Telegram users without additional safeguards (rate limits, monitoring, separate infrastructure).
- Keep `.env` secret; never commit real tokens or API keys.
