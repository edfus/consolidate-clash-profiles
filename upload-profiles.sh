#!/bin/bash

# Define the servers list (use a space-separated list of server IP addresses or hostnames)
encoded_servers="aG9zdGRhcmUgc2VydmFyaWNh"
# encoded_servers="c2VydmFyaWNh"

# Define the remote user and directory where you want to upload the profiles.js file
remote_user="root"
remote_directory="/root/C"

# Define the local path to the profiles.js file
local_file="./profiles.js"

# Decode the servers list
servers="$(echo "$encoded_servers" | base64 --decode)"

# Loop through the servers and use scp to upload the file
for server in $servers; do
  echo "Uploading profiles.js to $server"
  scp -o MACs=hmac-sha2-256 "$local_file" "$remote_user@$server:$remote_directory"
done

set -e
# echo "All uploads complete. Press any key to continue."
# read 
command='bash -i -c "cd /root/C || cd /root/T && ./index.sh update down up -c"'

# Loop through the servers and use scp to upload the file
for server in $servers; do
  echo "Deploying to $server"
  ssh -t -o MACs=hmac-sha2-256 "$remote_user@$server" "$command"
done
