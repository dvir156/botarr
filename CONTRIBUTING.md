# Contributing

Thanks for your interest in improving this project.

## Development

- **Node.js:** 20 or newer (see `engines` in `package.json`).
- Install dependencies: `npm install`
- Copy `.env.example` to `.env` and configure Telegram, LLM, and Radarr/Sonarr (Plex optional).
- Run in watch mode: `npm run dev`
- Typecheck: `npm run typecheck`
- Tests: `npm test`
- Production build: `npm run build` then `npm start`

## Pull requests

- Keep changes focused on one concern when possible.
- Run `npm run typecheck` and `npm test` before submitting.
- Describe what changed and why in the PR description.

## Code style

- Match existing patterns (strict TypeScript, Zod for validation, structured JSON logs).
- Avoid drive-by refactors in files you are not changing for the task.
