// `server-only` throws outside a React Server environment; unit tests import web server
// modules directly, so it resolves to this empty module under Vitest.
export {};
