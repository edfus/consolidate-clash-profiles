FROM node:20-alpine

# Use modern wrangler package
RUN npm install -g wrangler
RUN wrangler --version

USER root
COPY --chown=root:root . /app
WORKDIR /app

RUN chmod -R 765 /app/
RUN npm install
CMD [ "node", "server.js" ]