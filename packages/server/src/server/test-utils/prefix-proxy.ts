import http from "node:http";
import net from "node:net";

function headerLinesOf(headers: http.IncomingHttpHeaders): string[] {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
  }
  return lines;
}

export interface PrefixProxy {
  port: number;
  close(): Promise<void>;
}

/**
 * A minimal reverse proxy like the one in front of a session container: it
 * forwards only paths under `prefix`, unchanged, keeps the client's Host
 * header, and passes WebSocket upgrades through. Anything else gets 404.
 */
export async function startPrefixProxy(input: {
  prefix: string;
  targetPort: number;
}): Promise<PrefixProxy> {
  const { prefix, targetPort } = input;
  const bare = prefix.slice(0, -1);
  const underPrefix = (url: string | undefined) =>
    url !== undefined && (url === bare || url.startsWith(prefix));
  const sockets = new Set<net.Socket>();

  const server = http.createServer((req, res) => {
    if (!underPrefix(req.url)) {
      res.writeHead(404).end();
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, "x-forwarded-for": req.socket.remoteAddress ?? "" },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  server.on("upgrade", (req, clientSocket, head) => {
    if (!underPrefix(req.url)) {
      clientSocket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    const upstreamSocket = net.connect(targetPort, "127.0.0.1", () => {
      const headerLines = headerLinesOf(req.headers);
      upstreamSocket.write(
        `${req.method} ${req.url} HTTP/1.1\r\n${headerLines.join("\r\n")}\r\n\r\n`,
      );
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    for (const socket of [clientSocket as net.Socket, upstreamSocket]) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {
        clientSocket.destroy();
        upstreamSocket.destroy();
      });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    async close() {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
