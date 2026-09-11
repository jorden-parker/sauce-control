const http = require("node:http");

http
  .createServer((_request, response) => {
    response.end("hello from the fixture");
  })
  .listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
