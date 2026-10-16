import { writeFixturePacks } from './fixtures';

// Regenerates test/fixtures/packs (run: pnpm --filter @dm/tools exec tsx test/helpers/generate-fixtures.ts).
await writeFixturePacks();
