const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// --- Path to the Qt executable ---
const qtExecutablePath = path.resolve(__dirname, './qtsrc/cmake-build-debug/bin/KaiDiff'); // Adjust path!
const startupDelay = 3000; // Give Qt app time to start

// --- Path to the communication file ---
const communicationFilePath = path.join(require('os').tmpdir(), 'communication_file.txt');
console.log(`Node.js writing to: ${communicationFilePath}`);

// --- Start the Qt process ---
const qtProcess = spawn(qtExecutablePath);

// Helper function to send JSON to the file
function sendJson(obj) {
    const jsonString = JSON.stringify(obj);
    console.log(`Sending to Qt: ${jsonString}`);

    // Use synchronous file writing for simplicity and to ensure order.
    try {
        fs.writeFileSync(communicationFilePath, jsonString + '\n', { encoding: 'utf8' });
        console.log("Data written to file");
    } catch (err) {
        console.error("Error writing to file:", err);
    }
}

//Helper functions
function sendChatMessage(messageType, text) {
    sendJson({
        type: "chatMessage",
        messageType: messageType,
        text: text
    });
}

function sendRequestStatus(status) {
    sendJson({
        type: "requestStatus",
        status: status
    });
}

function sendApplyDiff() {
    sendJson({ type: "applyDiff" });
}

function sendDiffResult(files) {
    sendJson({
        type: "diffResult",
        files: files
    });
}

function sendDiffApplied() {
    sendJson({ type: "diffApplied" })
}

// Listen for output from the Qt app (stdout and stderr) -- Good for Debugging
qtProcess.stdout.on('data', (data) => {
    console.log(`Received from Qt (stdout): ${data.toString().trim()}`);
});

qtProcess.stderr.on('data', (data) => {
    console.error(`Received from Qt (stderr): ${data.toString().trim()}`);
});

qtProcess.on('close', (code) => {
    console.log(`Qt process exited with code ${code}`);
});

// --- Simulation Sequence (with Startup Delay) ---
setTimeout(() => {
    // 1. Send an initial user message
    sendChatMessage("User", "What is the capital of France?");
    sendRequestStatus(true);

    // 2. Simulate LLM response (after a delay)
    setTimeout(() => {
        sendChatMessage("LLM", "The capital of France is Paris.");
        sendRequestStatus(false);

        // 3. Send a diff result (after another delay)
        setTimeout(() => {
            const diffFiles = [
                {
                    path: "file1.txt",
                    content: "This is the original content.\n",
                },
                {
                    path: "file2.txt",
                    content: "This is the modified content.\n+This line was added.\n",
                },
            ];
            sendDiffResult(diffFiles);

            // 4. Send apply diff command.
            setTimeout(() => {
                sendApplyDiff();
                //5. Send diff applied
                setTimeout(() => {
                    sendDiffApplied();
                    console.log("Exiting Node Script"); // No need to kill, let it exit naturally
                }, 500);
            }, 500);
        }, 1000);
    }, 1500);
}, startupDelay);