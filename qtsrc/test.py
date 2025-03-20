# test.py  (Remove the "ready" signal waiting loop)
import socket
import json
import time
import subprocess
import sys
import signal

socket_path = 'KaiDiffLocalSocket'

def send_json_message(sock, message):
    json_string = json.dumps(message) + '\n'
    sock.sendall(json_string.encode('utf-8'))

def connect_with_retry(retries=10, interval=0.5):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    for attempt in range(retries):
        try:
            sock.connect(socket_path)
            print('Connected to KaiDiff!')
            return sock  # Return the socket on success
        except (FileNotFoundError, ConnectionRefusedError) as e:
            print(f"Connection attempt {attempt + 1}/{retries} failed: {e}")
            if attempt < retries - 1:
                time.sleep(interval)
            else:
                print("Failed to connect to KaiDiff after multiple retries.")
                sock.close()  # Close the socket before returning None
                return None

def handle_received_data(sock):
    received_data = ""
    while True:  # Keep reading until connection closed
        try:
            data = sock.recv(1024)  # Read in chunks
            if not data:
                break # No more data, connection closed
            received_data += data.decode('utf-8')
            while '\n' in received_data:
                message, received_data = received_data.split('\n', 1)
                message = message.strip()
                if message:
                    try:
                        parsed_message = json.loads(message)
                        print("Received from KaiDiff", parsed_message)

                        if parsed_message.get('status') == 'connected':
                            print('Connection confirmed. Sending test messages.')
                            send_json_message(sock, {'type': 'chatMessage', 'messageType': 'User', 'text': 'Hello from Python!'})
                            send_json_message(sock, {'type': 'requestStatus', 'status': True})
                            send_json_message(sock, {
                                'type': 'diffResult',
                                'files': [
                                    {'path': 'file1.txt', 'content': '+This is a new line'},
                                    {'path': 'file2.txt', 'content': '-This line was removed'}
                                ]
                            })
                            send_json_message(sock, {'type': 'applyDiff'})
                            send_json_message(sock, {'type': 'invalidType', 'data': 'some data'})
                            send_json_message(sock, {'type': 'quit'})

                    except json.JSONDecodeError as e:
                        print("Error parsing response:", message, e)

        except BlockingIOError:
            # Handle non-blocking socket read
            pass
        except Exception as e:
            print("Error while receiving data:", e)
            break

# --- Start KaiDiff ---
kai_diff_process = subprocess.Popen(['./cmake-build-debug/bin/KaiDiff'],
                                    stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE,
                                    text=True)

def signal_handler(sig, frame):
    print('Received SIGINT. Shutting down...')
    if client_socket:
        client_socket.close()
    kai_diff_process.terminate()
    try:
        kai_diff_process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        print("KaiDiff process did not terminate, killing it.")
        kai_diff_process.kill()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)

# --- Connect to KaiDiff (with retry) ---  NO MORE WAITING FOR "READY"
client_socket = connect_with_retry()

if client_socket:
    handle_received_data(client_socket)
    client_socket.close()
else:
    print("Could not connect")
    kai_diff_process.terminate()
