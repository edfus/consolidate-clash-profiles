#!/bin/sh

set -e

readonly __dirname=$(dirname "$(readlink -f "$0")")
cd "$__dirname"

read -e -p "Publish? (y/n)" -i " n" IS_PUBLISHING
IS_PUBLISHING=$(echo ${IS_PUBLISHING} | sed '/^\s*$/d')

if [ $IS_PUBLISHING == "y" ]; then
  wrangler publish
else
  wrangler preview
fi