#!/bin/bash

function transfer_file() {
  local server=$1
  local file_path=$2
  local remote_user=$3
  local remote_directory=$4

  # Get the base file name
  local file_name=$(basename "$file_path")

  # Split the current file
  split -b 3K "$file_path" "${file_name}_split_"

  # Update the local_files variable to include the split files
  local local_files="${file_name}_split_*"

  # Loop through each split file and upload it to the server
  for local_file in $local_files; do
    echo "Uploading $local_file to $server"
    if ! rsync -avz --progress --partial -e "ssh -o MACs=hmac-sha2-256" "$local_file" "$remote_user@$server:$remote_directory"; then
      echo "Upload failed for $local_file. Skipping $file_name"
      return 1
    fi
  done

  # Reassemble the file on the remote server
  ssh -o MACs=hmac-sha2-256 "$remote_user@$server" "cat ${remote_directory}/${file_name}_split_* > ${remote_directory}/$file_name" && \
  # Remove the split files from the remote server
  ssh -o MACs=hmac-sha2-256 "$remote_user@$server" "rm ${remote_directory}/${file_name}_split_*"

  # Remove the split files from the local machine
  rm ${local_files}
}

# Function to check if the file is a .url file, if so, download the url
function process_file() {
  local server=$1
  local file_path=$2
  local remote_user=$3
  local remote_directory=$4

  # Get the file extension
  local ext="${file_path##*.}"

  # Check if the file is a .url file
  if [ "$ext" = "url" ]; then
    # Read the url from the file
    url=$(cat "$file_path")

    # Download the file from the url and store it in a temporary file
    base_name=$(basename "$file_path" .url)
    tmp_file="/tmp/${base_name}.yml"
    curl -o "$tmp_file" "$url"

    # Transfer the downloaded file
    transfer_file $server $tmp_file $remote_user $remote_directory

    # Remove the temporary file
    rm "$tmp_file"
  else
    # Transfer the file
    transfer_file $server $file_path $remote_user $remote_directory
  fi
}

# Define the servers list (use a space-separated list of server IP addresses or hostnames)
encoded_servers="aG9zdGRhcmUgc2VydmFyaWNh"
# encoded_servers="aG9zdGRhcmU=" # h
# encoded_servers="c2VydmFyaWNh"
# encoded_servers="ZG1pdA=="

# Decode the servers list
servers="$(echo "$encoded_servers" | base64 --decode)"

# Define the remote user and directory where you want to upload the profiles.js file
remote_user="root"
remote_base_directory="/root/C"

# Get directory path from user
input_config_directory="./configs"
remote_config_directory="$remote_base_directory/caddy/config"

# Check if directory exists
if [ ! -d "$input_config_directory" ]; then
  echo "Directory $input_config_directory does not exist."
else
  # Find all files in the given directory
  files=$(find "$input_config_directory" -type f)

  # Loop through all servers
  for server in $servers; do
    # Loop through all files
    for file_path in $files; do
      # Call the process_file function
      process_file $server $file_path $remote_user $remote_config_directory
    done
  done
fi

# Define the local path to the files
local_files="./wrangler.toml injections.yml"
#!/bin/bash
# Loop through all servers
for server in $servers; do
  # Loop through all files
  for file_path in $local_files; do
    # Call the process_file function
    process_file $server $file_path $remote_user $remote_base_directory
  done
done


set -e
echo "All uploads complete. Press any key to continue."
read 
command='bash -i -c "cd /root/C && ./index.sh update down up -c"'

# Loop through the servers and use ssh to execute the command
for server in $servers; do
  echo "Deploying to $server"
  ssh -t -o MACs=hmac-sha2-256 "$remote_user@$server" "$command"
done
