const net = require('net');
const path = require('path');

// --- IMPORTANT: This MUST match the server name in main.cpp ---
const serverName = "MyUniqueLocalServerName2";
const socketPath = path.join((process.platform === 'win32' ? '\\\\.\\pipe\\' : ''), serverName);
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async function() {
    await delay(1000);

    const client = net.createConnection(socketPath, () => {
        console.log('Connected to C++ server.');

        // Send a simple JSON message
        const message1 = { type: 'greeting', message: 'Hello from Node.js!' };
        client.write(JSON.stringify(message1) + '\n');

        // Send another message after a short delay
        setTimeout(() => {
            const message2 = { type: 'anotherMessage', value: 42 };
            client.write(JSON.stringify(message2) + '\n');
            // Don't close the connection immediately, allow time for response
            // client.end(); // Remove client.end() here
        }, 500);
    });

    client.on('data', (data) => {
        console.log(`Received from C++ server: ${data.toString()}`);
    });

    client.on('end', () => {
        console.log('Disconnected from C++ server.');
    });

    client.on('error', (err) => {
        console.error('Connection error:', err);
    });
})();

