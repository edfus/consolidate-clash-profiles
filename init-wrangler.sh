#!/bin/bash

set -e

readonly __dirname=$(dirname "$(readlink -f "$0")")
cd "$__dirname"

set +e
rmdir wrangler.toml 2>/dev/null
set -e
read -e -p "account_id? " ACCOUNT_ID
read -e -p "zone_id? " ZONE_ID
read -e -p "route? " -i "google.com/*" VAR_ROUTE
read -e -p "name? " -i "$(echo $VAR_ROUTE | sed -e 's/\./-/g')" VAR_NAME

cat >wrangler.toml <<eof
type = "webpack"
account_id = "$ACCOUNT_ID"
workers_dev = false
name = "$VAR_NAME"
route = "$VAR_ROUTE"
zone_id = "$ZONE_ID"
compatibility_date = "2022-07-12"

[site]
bucket = "./external-rulesets"
entry-point = "cf-worker"
exclude = []
eof