// A loopback JSON-RPC proxy in front of a Surfpool fork (scripts/fork-sol.sh). Surfpool sends getSignaturesForAddress
// with `until` to the remote cluster, which does not know a signature made only on the fork and errors; a real node
// answers it. Here such a call is answered from the newest signatures, cut at `until` (the standard semantics: newer than
// `until`, newest first). Every other call, Surfpool's cheatcodes included, passes through unchanged.
//   node scripts/fork/sig-proxy.mjs <listen port> <upstream rpc>
import { createServer } from "node:http";

const [port, up] = [Number(process.argv[2]), process.argv[3]];
if (!port || !up) {
  console.error("node scripts/fork/sig-proxy.mjs <listen port> <upstream rpc>");
  process.exit(2);
}
const post = async (body) => (await fetch(up, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

async function one(req) {
  const o = req.method === "getSignaturesForAddress" ? req.params?.[1] : undefined;
  if (o?.until) {
    const { until, before, limit, ...rest } = o;
    const r = await post({ ...req, params: [req.params[0], { ...rest, ...(before ? { before } : {}), limit: 1000 }] });
    if (r.error) return r;
    const cut = r.result.findIndex((x) => x.signature === until);
    return { jsonrpc: "2.0", id: req.id, result: (cut === -1 ? r.result : r.result.slice(0, cut)).slice(0, limit ?? 1000) };
  }
  return post(req);
}

createServer((q, s) => {
  let b = "";
  q.on("data", (x) => (b += x));
  q.on("end", async () => {
    try {
      const j = JSON.parse(b);
      const r = Array.isArray(j) ? await Promise.all(j.map(one)) : await one(j);
      s.writeHead(200, { "content-type": "application/json" });
      s.end(JSON.stringify(r));
    } catch (e) {
      s.writeHead(502, { "content-type": "application/json" });
      s.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `sig-proxy: ${e.message}` } }));
    }
  });
}).listen(port, "127.0.0.1", () => console.log(`sig-proxy 127.0.0.1:${port} → ${up}`));
