const fs = require('fs');
const path = require('path');
const os = require('os'); // Import the 'os' module
// Determine the temporary directory (cross-platform)

// Use the home directory
const commFilePath = path.join(os.homedir(), 'communication.json');

function sendMessage(message) {
    try {
        // Convert the message to a JSON string and append a newline
        const jsonMessage = JSON.stringify(message) + '\n';

        // Append the message to the file (create it if it doesn't exist)
        fs.appendFileSync(commFilePath, jsonMessage, 'utf8');
        console.log(`Sent message to ${commFilePath}:`, message);
    } catch (err) {
        console.error('Error writing to communication file:', err);
    }
}

function sendChatMessage(text, messageType = "User") {
    sendMessage({
        type: "chatMessage",
        text: text,
        messageType: messageType
    });
}

function sendDiffResult(files) {
    sendMessage({
        type: "diffResult",
        files: files
    });
}

function sendRequestStatus(status) {
    sendMessage({
        type: "requestStatus",
        status: status
    });
}

function sendDiffApplied() {
    sendMessage({
        type: "diffApplied"
    });
}


// --- Example Usage (and testing) ---

setTimeout(() => {
    // Now, start sending messages:
    sendChatMessage("Initial message from Node.js!", "LLM");
    sendRequestStatus(true);


    setTimeout(() => {
        sendChatMessage("Another message from Node.js", "User");
        sendRequestStatus(false);
    }, 1000);

    setTimeout(() => {
        const diffFiles = [
            { path: "file1.js", content: "+console.log('Hello');\n-console.log('Goodbye');" },
            { path: "file2.css", content: "body {\n+  color: blue;\n-  color: red;\n}" }
        ];
        sendDiffResult(diffFiles);
    }, 2000);

    // setTimeout(() => {
    //     sendDiffApplied();
    // }, 3000);

    setTimeout(() => {
        sendChatMessage("And a final message", "LLM");
    }, 4000);
}, 3000);