// Gzip on disk and over the wire (Decision 13): the navmeshes and the distance table are committed and served as
// .gz files and inflated here, in the browser and in Node alike.

interface NodeZlib {
  gunzipSync(bytes: Uint8Array): Uint8Array;
}

/**
 * Inflates gzip `bytes`: with the platform's DecompressionStream('gzip') (browsers, Node 18+), else with Node's
 * zlib.gunzipSync (loaded only then, so a browser bundle never pulls it in). Rejects on bytes that are not gzip.
 */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    const zlibId = 'node:zlib';
    const zlib = (await import(/* @vite-ignore */ zlibId)) as NodeZlib;
    return new Uint8Array(zlib.gunzipSync(bytes));
  }
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Whether `bytes` start with the gzip magic (a server that sent Content-Encoding: gzip has already inflated them). */
export const isGzip = (bytes: Uint8Array): boolean => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
