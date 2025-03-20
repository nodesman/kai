// test.js (Corrected)
const net = require('net');
const { spawn } = require('child_process');

const socketPath = 'KaiDiffLocalSocket';

function sendJsonMessage(socket, message) {
    const jsonString = JSON.stringify(message) + '\n';
    socket.write(jsonString);
}

const kaiDiffProcess = spawn('./cmake-build-debug/bin/KaiDiff', {
    stdio: ['pipe', 'pipe', 'pipe']
});

kaiDiffProcess.stdout.setEncoding('utf8');
kaiDiffProcess.stderr.setEncoding('utf8');

let client; // Declare the client socket

kaiDiffProcess.stderr.on('data', (data) => {
    console.error(`STDERR: ${data}`);
});

kaiDiffProcess.on('close', (code) => {
    console.log(`KaiDiff process exited with code ${code}`);
    if (client) {
        client.destroy();
    }
});

kaiDiffProcess.on('error', (err) => {
    console.error('Failed to start KaiDiff process:', err);
    if (client) {
        client.destroy();
    }
});

function connectWithRetry(retries = 10, interval = 500) {
    client = new net.Socket();

    client.connect(socketPath, () => {
        console.log('Connected to KaiDiff!');
        setupDataHandler(); // Setup the data handler *after* successful connection
    });

    client.on('error', (err) => {
        if (err.code === 'ENOENT' && retries > 0) {
            console.log(`Connection attempt failed (retries remaining: ${retries}).  Trying again in ${interval}ms...`);
            setTimeout(() => connectWithRetry(retries - 1, interval), interval);
        } else {
            console.error('Socket connection error:', err);
            client.destroy(); // Clean up the socket
        }
    });

    client.on('end', () => {
        console.log('Connection closed by server.');
    });
    client.on('close', () => {
        console.log('Connection closed.');
    });
}


function setupDataHandler() {
    let socketReceived = '';

    client.on('data', (socketData) => {
        socketReceived += socketData.toString();
        let newlineIndex;

        while ((newlineIndex = socketReceived.indexOf('\n')) !== -1) {
            const socketMessage = socketReceived.substring(0, newlineIndex).trim();
            socketReceived = socketReceived.substring(newlineIndex + 1);

            if (socketMessage) {
                try {
                    const parsedMessage = JSON.parse(socketMessage);
                    console.log('Received from KaiDiff:', parsedMessage);

                    if (parsedMessage.status === 'connected') {
                        console.log('Connection confirmed. Sending test messages.');
                        sendJsonMessage(client, { type: 'chatMessage', messageType: 'User', text: 'Hello from Node.js!' });
                        sendJsonMessage(client, { type: 'requestStatus', status: true });
                        sendJsonMessage(client, {
                            type: 'diffResult',
                            files: [
                                { path: 'file1.txt', content: '+This is a new line' },
                                { path: 'file2.txt', content: '-This line was removed' }
                            ]
                        });
                        sendJsonMessage(client, { type: 'applyDiff' });
                        sendJsonMessage(client, { type: 'invalidType', data: 'some data' });
                        sendJsonMessage(client, {type: 'quit'});
                        console.log("Testing Complete");
                    }
                } catch (e) {
                    console.error("Error parsing response:", socketMessage, e);
                }
            }
        }
    });
}


connectWithRetry(); // Start the connection attempts

process.on('SIGINT', () => {
    console.log('Received SIGINT.  Shutting down...');
    if (client) {
        client.end(() => {
            console.log('Client connection closed.');
            kaiDiffProcess.kill('SIGINT');
            process.exit(0);
        });
    } else {
        kaiDiffProcess.kill('SIGINT'); // Ensure KaiDiff is killed
        process.exit(0);
    }
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    if (client) {
        client.destroy();
    }
    kaiDiffProcess.kill('SIGKILL'); // Ensure KaiDiff is killed
    process.exit(1);
});
