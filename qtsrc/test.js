const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`Client connected from ${ip}`);

    ws.on('message', (message) => {
        console.log(`Received from ${ip}: ${message}`);

        try {
            const json = JSON.parse(message);

            if (json.type === 'ready') {
                console.log("Qt Client is ready!");

                // Send initial chat messages *after* the client is ready
                setTimeout(() => {
                    ws.send(JSON.stringify({ type: 'chatMessage', messageType: "LLM", text: 'Hello from Node.js Server!' }));
                }, 500);
                setTimeout(() => {
                    ws.send(JSON.stringify({ type: 'chatMessage', messageType: "LLM", text: 'How are you?' }));
                }, 1500);

            } else if (json.type === 'chatMessage') {
                console.log(`Chat message from ${json.messageType}: ${json.text}`);

                // Echo the user's message back (as if it came from the LLM)
                setTimeout(() => {
                    ws.send(JSON.stringify({
                        type: "chatMessage",
                        messageType: "LLM",  // Pretend it's from the LLM
                        text: `You said: ${json.text}` // Echo with context
                    }));
                }, 500);



                if(json.messageType === "User"){ //if user sends, respond with diff
                    setTimeout(() => {
                        // Generate a large diff (example)
                        const longContent1 = 'Original file content.\n'.repeat(500) + 'Line added.\n';
                        const longContent2 = 'Original file content.\n'.repeat(500) + 'Line removed.\n';
                        const diffFiles = [
                            { path: 'large_file_1.txt', content: longContent1 },
                            { path: 'large_file_2.txt', content: `+${longContent2}` } //show as added in diff model
                        ];

                        ws.send(JSON.stringify({ type: 'diffResult', files: diffFiles }));

                    }, 1000); // Send diff after a delay.
                }

            } else if (json.type === 'applyDiff') {
                console.log("Apply Diff requested.");
                // Simulate applying diff (no actual diff application here)
                setTimeout(() => {
                    ws.send(JSON.stringify({ type: 'diffApplied' }));
                }, 1000);
            }
            else if (json.type === 'requestStatus') { //handle request status
                //do nothing as client is already handling

            }
            else {
                console.log("Unknown message type:", json.type);
                ws.send(JSON.stringify({ error: 'Unknown message type', received: json }));
            }
        } catch (error) {
            console.error('Invalid JSON or other error:', error);
            ws.send(JSON.stringify({ error: 'Invalid JSON format' }));
        }
    });

    ws.on('close', () => {
        console.log(`Client ${ip} disconnected`);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error from ${ip}:`, error);
    });
});

console.log('WebSocket server listening on port 8080');