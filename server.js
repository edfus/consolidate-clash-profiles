import { App } from "@edfus/file-server";
import { promises as fsp } from "fs";
const app = new App();
app
  .prepend(
    async (ctx, next) => {
      await next();
      logger.access([
        new Date().toLocaleString(),
        `${ctx.ip} ${ctx.req.method} ${ctx.req.url}`,
        ctx.res.statusCode
      ].join(" - "));
    }
  )
  .on("error", console.error)
;

let codes = [];

async function updateCodes () {
  const items = await fsp.readdir("./templates", { withFileTypes: true });
  codes = items.filter(dirent => dirent.isFile() && !dirent.startsWith("."));
}

app.use(async (ctx, next) => {
  const { req, res, state } = ctx;
  const url = state.uriObject;

  ctx.assert(["GET", "HEAD"].includes(req.method), 405, `Unexpected Method ${req.method}`);

  switch (url.pathname.replace(/^\//, "")) {
    case value:
      
      break;
  
    default:
      break;
  }
})

const server = app.listen(80, "0.0.0.0", function () {
  console.info(
    `File server is running at http://${hostname}:${this.address().port}`
  );
})

const shutdown = async () => {
  server.unref().close()
};

process.once("SIGINT", shutdown);
process.once("SIGQUIT", shutdown);
