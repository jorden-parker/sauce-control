const http = require("node:http");

// Bound to localhost only, the way Vite and similar development servers start by default.
http
  .createServer((_request, response) => {
    response.end("hello from localhost only");
  })
  .listen(Number(process.env.PORT ?? 5173), "localhost");
