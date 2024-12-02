#!/bin/bash


# Function to transfer a single file
function transfer_file() {
  local server=$1
  local file_path=$2
  local remote_user=$3
  local remote_directory=$4
  local use_chunks=$5

  # Try to transfer the file directly
  echo "Attempting to transfer $file_path to $server"
  if rsync -avz --progress --partial -e "ssh -o MACs=hmac-sha2-256" "$file_path" "$remote_user@$server:$remote_directory"; then
    echo "Transfer succeeded"
    return 0
  fi

  if [ "$use_chunks" -eq 1 ]; then
    # Get the base file name
    local file_name=$(basename "$file_path")

    # Split the current file
    echo "Transfer failed. Retrying with chunks"
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
    for local_file in $local_files; do
      rm ${local_file}
    done
  else
    echo "Transfer failed. Skipping $file_path"
  fi
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
    curl -o "$tmp_file" "$url" \
    -H 'Connection: keep-alive' \
    -H 'pragma: no-cache' \
    -H 'Accept: application/json, text/plain, */*' \
    -H 'sec-ch-ua-mobile: ?0' \
    -H 'User-Agent: ClashforWindows/0.20.7' \
    -H 'sec-ch-ua: " Not A;Brand";v="99", "Chromium";v="102"' \
    -H 'sec-ch-ua-platform: "Windows"' \
    -H 'Sec-Fetch-Site: cross-site' \
    -H 'Sec-Fetch-Mode: cors' \
    -H 'Sec-Fetch-Dest: empty' \
    -H 'Accept-Language: en-US'
    file_path="$tmp_file"
  else
    tmp_file=""
  fi

  local ext="${file_path##*.}"
  if [ "$ext" = "yml" ] || [ "$ext" = "yaml" ]; then
    # Check if the file is a valid YAML file
    if ! yq e . "$file_path" >/dev/null 2>&1; then
      echo "Skipping $file_path because it is not a valid YAML file"
      cat "$file_path" | head -n 3
      return 1
    fi
  fi

  # Check the file size (in bytes)
  # Detect the operating system
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    file_size=$(stat -f%z "$file_path")
  else
    # Linux
    file_size=$(stat -c%s "$file_path")
  fi

  # Set use_chunks=0 if the file is larger than 10MB
  if [ "$file_size" -gt 10048576 ]; then
    transfer_file $server $file_path $remote_user $remote_directory 0
  else
    transfer_file $server $file_path $remote_user $remote_directory 1
  fi

  if [ -f "$tmp_file" ]; then
    # Remove the temporary file
    rm "$tmp_file"
  fi
}

# Define the servers list (use a space-separated list of server IP addresses or hostnames)
# encoded_servers="aG9zdGRhcmUgc2VydmFyaWNh"
# encoded_servers="aG9zdGRhcmU=" # h
encoded_servers="ZG1pdCBob3N0ZGFyZQo=" # dmit + h 
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
local_files="wrangler.toml injections.yml profiles.js"
#!/bin/bash
# Loop through all servers
for server in $servers; do
  # Loop through all files
  for file_path in $local_files; do
    # Call the process_file function
    process_file $server $file_path $remote_user $remote_base_directory
  done
done

# Remove the split files from the local machine
for local_file in "*_split_*"; do
  rm ${local_file}
done

set -e
echo "All uploads complete. Press any key to continue."
read 
# command='bash -i -c "cd /root/C && ./index.sh -c && ./srv-shuf-fallback.sh && ./srv-shuf-fallback.sh && ./srv-shuf-fallback.sh && ./srv-shuf-fallback.sh"'
command='bash -i -c "cd /root/C && ./index.sh update down up -c && ./srv-shuf-fallback.sh && ./srv-shuf-fallback.sh && ./srv-shuf-fallback.sh && ./srv-shuf-fallback.sh && ./srv-shuf-fallback.sh && ./srv-shuf-fallback.sh && ./srv-shuf-fallback.sh"'

# Loop through the servers and use ssh to execute the command
for server in $servers; do
  echo "Deploying to $server"
  ssh -t -o MACs=hmac-sha2-256 "$remote_user@$server" "$command"
done
