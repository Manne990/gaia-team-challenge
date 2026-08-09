# Architecture

Northstar is a single Node process: Express owns `/api`, while Vite provides
the React client in development and the compiled client is served in production.
This keeps local startup self-contained and leaves a stable boundary for
feature routes under `src/server` and screens under `src/client`.

`src/shared/config.ts` is the only configuration entry point. It validates
environment values before startup and resolves `CRM_DB_PATH` from the process
working directory. Database commands use that same configuration, so test and
release tooling can direct data to an isolated path.

Future migrations and domain repositories belong behind server routes; client
code must use API responses rather than access local persistence. Expected API
failures use stable `{ error: { code, message } }` envelopes. Unexpected
failures are logged without secrets and presented as safe retry guidance.
