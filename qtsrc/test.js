const { spawn } = require('child_process');
const path = require('path');

// Path to your KaiDiff executable.
const kaiDiffPath = path.join(__dirname, './', 'cmake-build-debug', 'bin', 'KaiDiff'); // Modify path
const scriptDir = __dirname;
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
    const kaiDiffProcess = spawn(kaiDiffPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.resolve(scriptDir, './')
    });

    // --- Redirect and Capture stderr ---
    let stderrOutput = ''; // Store stderr output
    kaiDiffProcess.stderr.on('data', (data) => {
        stderrOutput += data; // Accumulate stderr data
        process.stdout.write(data); //  Write to Node.js's stdout (console)
    });

    // --- Redirect stdout and WAIT FOR READY ---
    let stdoutOutput = '';
    kaiDiffProcess.stdout.on('data', async (data) => {
        stdoutOutput += data;
        process.stdout.write(data); // Echo to console

        // Check for the "READY" signal
        if (stdoutOutput.includes('READY')) {
            // Now it's safe to send messages
            console.log("KaiDiff is ready. Sending messages...");

            // --- Test Cases (Moved inside the 'READY' check) ---
            console.log("Sending chatMessage...");
            sendJsonMessage(kaiDiffProcess, { type: 'chatMessage', messageType: 'User', text: 'Hello from Node.js!' });
            await delay(500);

            console.log("Sending requestStatus...");
            sendJsonMessage(kaiDiffProcess, { type: 'requestStatus', status: true });
            await delay(500);

            // ... (the rest of your test messages) ...
            console.log("Sending diffResult...");
            sendJsonMessage(kaiDiffProcess, {
                type: 'diffResult',
                files: [
                    { path: 'file1.txt', content: '+This is a new line' },
                    { path: 'file2.txt', content: '-This line was removed' }
                ]
            });
            await delay(500);
            //
            console.log("Sending applyDiff...");
            sendJsonMessage(kaiDiffProcess, { type: 'applyDiff' });
            await delay(500);
            //
            console.log("Sending invalid message type...");
            sendJsonMessage(kaiDiffProcess, { type: 'invalidType', data: 'some data' });
            await delay(500);
            //
            console.log("Sending chat message followed by large diff...");
            sendJsonMessage(kaiDiffProcess, { type: 'chatMessage', messageType: 'User', text: 'Preparing large diff...' });
            await delay(500);
            const largeDiffFiles = [];
            for (let i = 0; i < 100; i++) {
                largeDiffFiles.push({ path: `large_file_${i}.txt`, content: `+Large content line ${i}` });
            }
            sendJsonMessage(kaiDiffProcess, { type: 'diffResult', files: largeDiffFiles });
            await delay(2000);
            //
            console.log("Testing QSocketNotifier Flooding...");
            for(let i = 0; i < 50; i++) {
                sendJsonMessage(kaiDiffProcess, { type: 'chatMessage', messageType: 'User', text: `Flooding message ${i}` });
                await delay(50);
            }
            await delay(1000);
            //
            console.log("Sending invalid chatMessage...");
            sendJsonMessage(kaiDiffProcess, { type: 'chatMessage',  text: 'Hello from Node.js!' });
            await delay(500);
            //
            console.log("Sending invalid requestStatus...");
            sendJsonMessage(kaiDiffProcess, { type: 'requestStatus',  });
            await delay(500);
            //
            console.log("Sending large chat history...");
            for (let i = 0; i < 50; i++) {
                sendJsonMessage(kaiDiffProcess, { type: 'chatMessage', messageType: 'LLM', text: `Response line ${i}: ` + "This is a very long line of text to simulate a lengthy chat history entry. ".repeat(10) });
                await delay(100);
            }
            await delay(2000);

            console.log("Testing complete.");
            kaiDiffProcess.stdin.end(); // Close the input stream

        }
    });

    // Handle process exit
    kaiDiffProcess.on('close', (code) => {
        console.log(`KaiDiff process exited with code ${code}`);
    });

    kaiDiffProcess.stdin.setEncoding('utf-8');
}

testKaiDiff();