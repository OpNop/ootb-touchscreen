// Must be the first import anywhere so process.env is populated before other modules read it.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* no .env file; rely on real environment */
}
