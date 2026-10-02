# Kino XII

Cinema-ticketing single-page application for the Redberry Bootcamp XII assignment.

## Technology

- React
- JavaScript
- Vite
- React Router
- HTML5
- CSS3
- Fetch API
- native browser APIs where appropriate

## Documentation

Canonical project documentation is stored in the `docs/` directory.

Source-of-truth priority:

1. OpenAPI — backend/API behavior
2. Assignment — required functionality and business rules
3. Figma — visual design, states, spacing, and layout
4. Accepted project decisions in `docs/06_DECISIONS.md`

## Development

Install dependencies with `npm install`.

Start the Vite development server with `npm run dev`.

Run ESLint with `npm run lint`.

Create a production build with `npm run build`.

Preview the production build locally with `npm run preview`.

VS Code Live Server is not used for this React application.

## API

Production API base:

https://api.kinoxii.redberryinternship.ge/api

Server-controlled business values must be loaded from `/filter-options` rather than hardcoded.

## Deployment

The production SPA is configured for Netlify.

- build command: `npm run build`
- publish directory: `dist`
- SPA fallback configuration: `netlify.toml`

## Implementation

Implementation proceeds incrementally according to the Assignment, OpenAPI contract, Figma, architecture, and accepted project decisions.
