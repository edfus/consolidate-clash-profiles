#!/bin/bash

set -e

readonly __dirname=$(dirname "$(readlink -f "$0")")
cd "$__dirname"

set +e
rmdir wrangler.toml 2>/dev/null
set -e
read -e -p "account_id? " ACCOUNT_ID
read -e -p "route? " -i "google.com/*" VAR_ROUTE
read -e -p "name? " -i "$(echo $VAR_ROUTE | sed -e 's/\./-/g')" VAR_NAME

cat >wrangler.toml <<eof
main = "cf-worker/index.js"
account_id = "$ACCOUNT_ID"
workers_dev = false
name = "$VAR_NAME"
route = "$VAR_ROUTE"
compatibility_date = "2022-07-12"

[site]
bucket = "./external-rulesets"
exclude = []
eof