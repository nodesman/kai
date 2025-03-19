import subprocess
import json
import time
import sys
import os

# --- Path to the Qt executable ---
# Use os.path.join for better cross-platform compatibility
qt_executable_path = os.path.join(os.path.dirname(__file__), "qtsrc", "cmake-build-debug", "bin", "KaiDiff")  # Adjust path!
startup_delay = 3  # Startup delay in seconds

# --- Helper functions ---

def send_json(proc, obj):
    """Sends a JSON object to the Qt process."""
    json_string = json.dumps(obj)
    print(f"Sending to Qt: {json_string}")
    proc.stdin.write(json_string + "\n")  # Add newline for Qt to read line by line
    proc.stdin.flush()  # Ensure data is sent immediately
    print("Data flushed to Qt stdin")


def send_chat_message(message_type, text):
    """Sends a chat message."""
    send_json(qt_process, {
        "type": "chatMessage",
        "messageType": message_type,
        "text": text
    })

def send_request_status(status):
    """Sends a request status update."""
    send_json(qt_process, {
        "type": "requestStatus",
        "status": status
    })

def send_apply_diff():
    """Sends the applyDiff command."""
    send_json(qt_process, {"type": "applyDiff"})

def send_diff_result(files):
    """Sends a diff result."""
    send_json(qt_process, {
        "type": "diffResult",
        "files": files
    })

def send_diff_applied():
    send_json(qt_process, {"type": "diffApplied"})

# --- Start the Qt process ---

# Use shell=False for security and better control, and capture output
try:
    qt_process = subprocess.Popen(
        [qt_executable_path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,  # Capture stdout
        stderr=subprocess.PIPE,  # Capture stderr
        text=True,  # Use text mode for I/O (important for encoding)
        bufsize=0, #  Unbuffered I/O, or
        # bufsize=1, #  Line buffered. Both options are better than fully buffered.
    )

except FileNotFoundError:
    print(f"Error: Qt executable not found at {qt_executable_path}")
    sys.exit(1)
except Exception as e:
    print(f"Error starting Qt process: {e}")
    sys.exit(1)


# Give the Qt app time to start.  Essential for reliable communication.
time.sleep(startup_delay)


# --- Simulation Sequence ---

# 1. Send an initial user message
send_chat_message("User", "What is the capital of France?")
send_request_status(True)

# 2. Simulate LLM response (after a delay)
time.sleep(1.5)
send_chat_message("LLM", "The capital of France is Paris.")
send_request_status(False)

# 3. Send a diff result (after another delay)
time.sleep(1)
diff_files = [
    {
        "path": "file1.txt",
        "content": "This is the original content.\n",
    },
    {
        "path": "file2.txt",
        "content": "This is the modified content.\n+This line was added.\n",
    },
]
send_diff_result(diff_files)

# 4. Send apply diff command (after another delay)
time.sleep(0.5)
send_apply_diff()

#5 Send confirmation
time.sleep(0.5)
send_diff_applied()

# --- Read output from Qt (in a separate thread for non-blocking I/O) ---
# This is good practice to avoid deadlocks, but for this simple example,
# we can read sequentially *after* sending all the data.

def read_output(stream, label):
    """Reads output from a stream (stdout or stderr) and prints it."""
    for line in iter(stream.readline, ""):
        print(f"Received from Qt ({label}): {line.strip()}")

import threading
stdout_thread = threading.Thread(target=read_output, args=(qt_process.stdout, "stdout"))
stderr_thread = threading.Thread(target=read_output, args=(qt_process.stderr, "stderr"))
stdout_thread.start()
stderr_thread.start()

# Wait for the Qt process to finish (optional, in this case, since we send 'exit')
qt_process.wait()
stdout_thread.join() #Ensure the thread is complete
stderr_thread.join()
print(f"Qt process exited with code {qt_process.returncode}")