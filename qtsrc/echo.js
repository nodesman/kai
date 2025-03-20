// echo_server.js

// Use strict mode for better error handling
'use strict';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (data) => {
    // Remove any trailing whitespace (including newlines!)
    const trimmedData = data.trim();

    // Check if we received a "quit" command
    if (trimmedData === 'quit') {
        console.log('Exiting echo server...');
        process.exit(0); // Exit cleanly
    }

    // Parse the incoming data as JSON
    try {
        const receivedJson = JSON.parse(trimmedData);
        console.log("Received:", receivedJson); //Log incoming json

        // Echo back the JSON, with an added "echoed" property.  Send as a string
        console.log(JSON.stringify({ ...receivedJson, echoed: true, from: 'echo_server' }) + '\n');

    } catch (error) {
        console.error("Invalid JSON received:", trimmedData); // Log invalid JSON
        console.error("Error:", error.message);

        // Send back an error message as JSON
        console.log(JSON.stringify({ error: 'Invalid JSON', received: trimmedData, from: 'echo_server' }) + "\n");
    }
});

process.stdin.on('end', () => {
    console.log('stdin closed.  Echo server shutting down.');
});

// Handle errors on stdin (optional, but good practice)
process.stdin.on('error', (err) => {
    console.error('Error on stdin:', err);
});

//Signal that the echo server has started.
console.log(JSON.stringify({status: "Echo server started", from: "echo_server"}) + "\n");