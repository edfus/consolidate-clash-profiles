#!/bin/sh

# Prompt the user for the remote server address
echo "Enter the remote server address:"
read REMOTE_SERVER

# Prompt the user for the remote server user
echo "Enter the remote server user:"
read REMOTE_USER

# Create a temporary script file for the remote setup
REMOTE_SCRIPT_FILE="remote_setup_tmp.sh"

cat > $REMOTE_SCRIPT_FILE << 'EOL'
#!/bin/sh
docker ps | grep clash

# Prompt the user for the Docker container ID
echo "Enter the Docker container ID:"
read CONTAINER_ID

# Attach to the running container, find the Node.js process ID, and send the SIGUSR1 signal
NODE_PID=$(docker exec $CONTAINER_ID sh -c "ps aux | grep 'node' | grep -v 'grep' | awk '{print \$1}'")
docker exec $CONTAINER_ID sh -c "kill -s SIGUSR1 $NODE_PID"

# Get the target container's IP address
TARGET_CONTAINER_IP=$(docker inspect $CONTAINER_ID --format '{{ .NetworkSettings.Networks.caddy.IPAddress }}')

# Choose the desired port to expose on the host machine and the port number the target container is listening on
HOST_PORT=9229
TARGET_CONTAINER_PORT=9229

# Check if a socat container is already running
SOCAT_CONTAINER_ID=$(docker ps --filter "ancestor=alpine/socat" --filter "publish=$HOST_PORT" -q)

if [ -z "$SOCAT_CONTAINER_ID" ]; then
  IS_EXPOSED="$(docker inspect $CONTAINER_ID --format '{{ .Config.ExposedPorts }}' | grep $TARGET_CONTAINER_PORT)"
  if [ -z "$IS_EXPOSED" ]; then
    echo "Port $TARGET_CONTAINER_PORT is not exposed on container $CONTAINER_ID. $(docker inspect $CONTAINER_ID --format '{{ .Config.ExposedPorts }}')"
  else
    # Run a new socat container that forwards traffic from the host machine to the target container
    docker run --network caddy --rm -d -p 127.0.0.1:$HOST_PORT:1234 --name socat_forwarder alpine/socat TCP-LISTEN:1234,fork TCP-CONNECT:$TARGET_CONTAINER_IP:$TARGET_CONTAINER_PORT
    echo "Docker container port forwarding complete."
  fi
else
  echo "A socat forwarding container is already running (Container ID: $SOCAT_CONTAINER_ID)."
fi
EOL

# Split the profiles.js file
split -b 1K $REMOTE_SCRIPT_FILE ${REMOTE_SCRIPT_FILE}_split_

# Update the local_files variable to include the split files
local_files="${REMOTE_SCRIPT_FILE}_split_*"

set -e

for local_file in $local_files; do
  echo "Uploading $local_file to $REMOTE_SERVER"
  # Upload and execute the remote script on the remote server
  scp -o MACs=hmac-sha2-256 $local_file $REMOTE_USER@$REMOTE_SERVER:/tmp/$local_file
done

echo Reassembling the $REMOTE_SCRIPT_FILE file on the remote server
ssh -o MACs=hmac-sha2-256 "$REMOTE_USER@$REMOTE_SERVER" "cat /tmp/${REMOTE_SCRIPT_FILE}_split_* > /tmp/$REMOTE_SCRIPT_FILE"

echo Removing the split files
ssh -o MACs=hmac-sha2-256 "$REMOTE_USER@$REMOTE_SERVER" "rm /tmp/${REMOTE_SCRIPT_FILE}_split_*"

# Remove the split files from the local machine
rm ${REMOTE_SCRIPT_FILE}_split_*
# Remove the temporary remote script file
rm $REMOTE_SCRIPT_FILE

echo Running the script
set +e
ssh -o MACs=hmac-sha2-256  $REMOTE_USER@$REMOTE_SERVER "chmod +x /tmp/$REMOTE_SCRIPT_FILE && /tmp/$REMOTE_SCRIPT_FILE && rm /tmp/$REMOTE_SCRIPT_FILE"
exit_code=$?
if [ $exit_code != 0 ]; then
  exit $exit_code
fi
# Set the local and remote debugging port
REMOTE_PORT=9229
LOCAL_PORT=9229

# Forward the debugging port from the remote host machine to the local machine using SSH
ssh -N -f -o MACs=hmac-sha2-256  -L 127.0.0.1:$LOCAL_PORT:127.0.0.1:$REMOTE_PORT $REMOTE_USER@$REMOTE_SERVER

echo "Port forwarding complete. You can now attach the debugger in Visual Studio Code."
echo 'You can exit by doing a ps aux | grep ssh to find PID of ssh-forwarding process, then use sudo kill -9 $PID to kill it.'
