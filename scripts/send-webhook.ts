// Dev tool: signs a GitHub fixture with GITHUB_WEBHOOK_SECRET and POSTs it to the local api.
// Usage: npm run webhook:send -- <fixture> [deliveryId]
//   e.g. npm run webhook:send -- pull_request.opened
//        npm run webhook:send -- pull_request.opened 3f2a...   (resend to test dedupe)
// Fixtures live in packages/shared/test/fixtures/github/.
import { buildSignedWebhook, loadGithubFixture } from '@mergemind/shared/testing';

const DEFAULT_URL = 'http://localhost:4000/webhooks/github';

async function main(): Promise<void> {
  const [fixtureName, deliveryId] = process.argv.slice(2);
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (fixtureName === undefined) {
    throw new Error('Usage: npm run webhook:send -- <fixture> [deliveryId]');
  }
  if (secret === undefined || secret === '') {
    throw new Error('GITHUB_WEBHOOK_SECRET is not set (add it to .env)');
  }

  const { event, payload } = await loadGithubFixture(fixtureName);
  const signed = buildSignedWebhook({
    event,
    payload,
    secret,
    ...(deliveryId === undefined ? {} : { deliveryId }),
  });
  const url = process.env.WEBHOOK_URL ?? DEFAULT_URL;

  const response = await fetch(url, { method: 'POST', headers: signed.headers, body: signed.body });

  console.log(`${event} delivery ${signed.deliveryId} -> HTTP ${response.status}`);
  console.log(await response.text());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
