import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

const headers = new class extends Headers {
  applyTo(response) {
    for (const [key, value] of this.entries()) {
      response.headers.set(key, value);
    }

    return response;
  }
};

self.addEventListener("fetch", event => {
  event.respondWith(
    (async () => {
      const url = new URL(event.request.url);
      const hours = 60 * 60;
      const days = 24 * hours;

      // serving files
      try {
        // catch-all options
        const options = {
          cacheControl: {
            edgeTtl: .5 * hours,
            browserTtl: .5 * hours,
            cacheEverything: true
          }
        };

        // css files
        if (/.css$/.test(url.pathname)) {
          options.cacheControl = {
            edgeTtl: 180 * days,
            browserTtl: 180 * days,
            cacheEverything: true
          };

          headers.set("cache-control", `max-age=${180 * days}`);
        }

        return headers.applyTo(await getAssetFromKV(event, options));
      } catch (err) {
        try {
          const notFoundResponse = await getAssetFromKV(event, {
            mapRequestToAsset: req => new Request(`${url.origin}/404.html`, req),
          });
  
          return new Response(notFoundResponse.body, { ...notFoundResponse, status: 404 });
        } catch {
          return new Response(`The requested URL <code>${url.pathname}</code> was not found on this server.`, { status: 404 });
        }
      }
    })().catch(err => new Response(
      "Internal Error: ".concat(err.message), { status: 500 }
    ))
  );
});

