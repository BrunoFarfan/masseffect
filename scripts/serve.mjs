import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const path = resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (
      !path.startsWith(root.endsWith(sep) ? root : root + sep) ||
      pathname.split("/").some((p) => p.startsWith("."))
    ) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(path);
    res
      .writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(5173, "127.0.0.1", () =>
  console.log("Mass Effect → http://127.0.0.1:5173"),
);
