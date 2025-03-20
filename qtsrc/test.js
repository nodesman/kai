const { spawn } = require('child_process');
const path = require('path');

// Path to your KaiDiff executable.
const kaiDiffPath = path.join(__dirname, './', 'cmake-build-debug', 'bin', 'KaiDiff'); // Modify path

// Function to send a JSON message
function sendJsonMessage(process, message) {
    const jsonString = JSON.stringify(message);
    process.stdin.write(jsonString + '\n');
}

// Function for delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testKaiDiff() {
    // Spawn the KaiDiff process
    const kaiDiffProcess = spawn(kaiDiffPath);

    // --- Redirect and Capture stderr ---
    let stderrOutput = ''; // Store stderr output
    kaiDiffProcess.stderr.on('data', (data) => {
        stderrOutput += data; // Accumulate stderr data
        process.stdout.write(data); //  Write to Node.js's stdout (console)
    });

    // --- Redirect and Capture stdout ---
    let stdoutOutput = ''; // Store stdout output
    kaiDiffProcess.stdout.on('data', (data) => {
        stdoutOutput += data;  // Accumulate stdout data
        process.stdout.write(data); // Write to Node.js's stdout (console)
    });

    // Handle process exit
    kaiDiffProcess.on('close', (code) => {
        console.log(`KaiDiff process exited with code ${code}`);

        // --- Output captured data (optional, but useful for analysis) ---
        // console.log("\n--- Captured KaiDiff stderr ---");
        // console.log(stderrOutput);
        // console.log("--- End Captured stderr ---");

        // console.log("\n--- Captured KaiDiff stdout ---");
        // console.log(stdoutOutput);
        // console.log("--- End Captured stdout ---");
    });

    kaiDiffProcess.stdin.setEncoding('utf-8');

    // --- Test Cases ---
    console.log("Sending chatMessage...");
    sendJsonMessage(kaiDiffProcess, { type: 'chatMessage', messageType: 'User', text: 'Hello from Node.js!' });
    await delay(500);

    console.log("Sending requestStatus...");
    sendJsonMessage(kaiDiffProcess, { type: 'requestStatus', status: true });
    await delay(500);

    console.log("Sending diffResult...");
    sendJsonMessage(kaiDiffProcess, {
        type: 'diffResult',
        files: [
            { path: 'file1.txt', content: '+This is a new line' },
            { path: 'file2.txt', content: '-This line was removed' }
        ]
    });
    await delay(500);

    console.log("Sending applyDiff...");
    sendJsonMessage(kaiDiffProcess, { type: 'applyDiff' });
    await delay(500);

    console.log("Sending invalid message type...");
    sendJsonMessage(kaiDiffProcess, { type: 'invalidType', data: 'some data' });
    await delay(500);

    console.log("Sending chat message followed by large diff...");
    sendJsonMessage(kaiDiffProcess, { type: 'chatMessage', messageType: 'User', text: 'Preparing large diff...' });
    await delay(500);
    const largeDiffFiles = [];
    for (let i = 0; i < 100; i++) {
        largeDiffFiles.push({ path: `large_file_${i}.txt`, content: `+Large content line ${i}` });
    }
    sendJsonMessage(kaiDiffProcess, { type: 'diffResult', files: largeDiffFiles });
    await delay(2000);

    console.log("Testing QSocketNotifier Flooding...");
    for(let i = 0; i < 50; i++) {
        sendJsonMessage(kaiDiffProcess, { type: 'chatMessage', messageType: 'User', text: `Flooding message ${i}` });
        await delay(50);
    }
    await delay(1000);

    console.log("Sending invalid chatMessage...");
    sendJsonMessage(kaiDiffProcess, { type: 'chatMessage',  text: 'Hello from Node.js!' });
    await delay(500);

    console.log("Sending invalid requestStatus...");
    sendJsonMessage(kaiDiffProcess, { type: 'requestStatus',  });
    await delay(500);

    console.log("Sending large chat history...");
    for (let i = 0; i < 50; i++) {
        sendJsonMessage(kaiDiffProcess, { type: 'chatMessage', messageType: 'LLM', text: `Response line ${i}: ` + "This is a very long line of text to simulate a lengthy chat history entry. ".repeat(10) });
        await delay(100);
    }
    await delay(2000);

    console.log("Testing complete.");
    kaiDiffProcess.stdin.end(); // Close the input stream
}

testKaiDiff();