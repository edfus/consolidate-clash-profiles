FROM node:16-alpine

# https://github.com/cloudflare/wrangler/issues/803#issuecomment-551431152
RUN npm install -g @cloudflare/wrangler --unsafe-perm=true --allow-root
RUN wrangler --version

USER root
COPY --chown=root:root . /app
WORKDIR /app

RUN chmod -R 765 /app/
RUN npm install
CMD [ "node", "server.js" ]