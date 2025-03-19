// echo_server.js
process.stdin.on('data', (data) => {
    const receivedData = data.toString().trim();
    console.log(`Received: ${receivedData}`);
    process.stdout.write(`Echo: ${receivedData}\n`); // Echo back with a prefix
});

process.stdin.on('end', () => {
    console.log('stdin closed.');
    process.exit(0);
});

console.log('Echo server started.  Waiting for input...');