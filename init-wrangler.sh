#!/bin/sh

set -e

readonly __dirname=$(dirname "$(readlink -f "$0")")
cd "$__dirname"

read -e -p "account_id? " ACCOUNT_ID
read -e -p "zone_id? " ZONE_ID
read -e -p "route? " -i "google.com/*" VAR_ROUTE
read -e -p "name? " -i "$(echo $VAR_ROUTE | sed -e 's/\./-/')" VAR_NAME

cat >wrangler.toml <<eof
type = "webpack"
account_id = "$ACCOUNT_ID"
workers_dev = false
name = "$VAR_NAME"
route = "$VAR_ROUTE"
zone_id = "$ZONE_ID"

[site]
bucket = "./external-rulesets"
entry-point = "cf-worker"
exclude = []
eof