#!/bin/bash

# Define the servers list (use a space-separated list of server IP addresses or hostnames)
# encoded_servers="aG9zdGRhcmUgc2VydmFyaWNh"
# encoded_servers="aG9zdGRhcmU=" # h
encoded_servers="c2VydmFyaWNh"
# encoded_servers="ZG1pdA=="

# Decode the servers list
servers="$(echo "$encoded_servers" | base64 --decode)"

# Define the remote user and directory where you want to upload the profiles.js file
remote_user="root"
remote_directory="/root/C"


# Define the local path to the files
local_files="./wrangler.toml injections.yml"

# Split the profiles.js file
split -b 3K profiles.js profiles_split_

# Update the local_files variable to include the split files
local_files="profiles_split_* $local_files"

# Loop through the servers and use rsync to upload the file
for server in $servers; do
  for local_file in $local_files; do
    echo "Uploading $local_file to $server"
    rsync -avz --progress --partial -e "ssh -o MACs=hmac-sha2-256" "$local_file" "$remote_user@$server:$remote_directory"
  done

  # Reassemble the profiles.js file on the remote server
  ssh -o MACs=hmac-sha2-256 "$remote_user@$server" "cat ${remote_directory}/profiles_split_* > ${remote_directory}/profiles.js"

  # Remove the split files from the remote server
  ssh -o MACs=hmac-sha2-256 "$remote_user@$server" "rm ${remote_directory}/profiles_split_*"
done

# Remove the split files from the local machine
rm profiles_split_*

set -e
echo "All uploads complete. Press any key to continue."
read 
command='bash -i -c "cd /root/C && ./index.sh update down up -c"'

# Loop through the servers and use ssh to execute the command
for server in $servers; do
  echo "Deploying to $server"
  ssh -t -o MACs=hmac-sha2-256 "$remote_user@$server" "$command"
done
