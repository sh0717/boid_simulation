import { createHash } from 'node:crypto';
import { CORE_BASE64, CORE_METADATA } from '../src/simulation/generated/core-binary.js';
import { coreSourceHash } from './core-sources.mjs';

// Normal web/desktop builds consume the checked-in binary without requiring an SDK.
// A changed C++ source must be rebuilt explicitly, preventing stale packaged logic.
export async function checkCore() {
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  if ((await coreSourceHash()) !== CORE_METADATA.sourceSha256)
    throw new Error('C++ core source changed. Run npm run build:core before building or testing.');
  const bytes = Buffer.from(CORE_BASE64, 'base64');
  if (hash(bytes) !== CORE_METADATA.wasmSha256 || bytes.length !== CORE_METADATA.bytes)
    throw new Error('C++ core binary checksum mismatch. Run npm run build:core.');
}
