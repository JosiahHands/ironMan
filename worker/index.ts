// Cloudflare Worker: serves videos with proper "range request" support.
//
// Safari's engine (used by Safari and DuckDuckGo on Mac) asks for a video in pieces,
// e.g. "Range: bytes=0-1", and only plays it if the server answers with exactly that
// piece (status 206). Cloudflare's static file serving sends the whole file instead
// (status 200), which can stop videos from playing.
//
// This Worker only runs for /media/videos/* (see "run_worker_first" in wrangler.jsonc).
// Every other file is served straight from web/ by Cloudflare, without this code.

type Env = {
  ASSETS: { fetch(request: Request): Promise<Response> };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Get the whole file from the site's static files (without the Range header)
    const file = await env.ASSETS.fetch(new Request(request.url));
    if (!file.ok) return file;

    const headers = new Headers(file.headers);
    headers.set("Accept-Ranges", "bytes"); // tell browsers they may ask for pieces
    const sendBody = request.method !== "HEAD";

    // "bytes=START-END", "bytes=START-" or "bytes=-LAST_N"; anything else gets the whole file
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range")?.trim() ?? "");
    if (!range || (range[1] === "" && range[2] === "")) {
      return new Response(sendBody ? file.body : null, { status: 200, headers });
    }

    const data = await file.arrayBuffer();
    const size = data.byteLength;
    let start: number;
    let end: number;
    if (range[1] === "") {
      // "bytes=-500" means the last 500 bytes
      start = Math.max(0, size - Number(range[2]));
      end = size - 1;
    } else {
      start = Number(range[1]);
      end = range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
    }

    // A piece that doesn't exist in the file
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }

    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(sendBody ? data.slice(start, end + 1) : null, { status: 206, headers });
  },
};
