// src/lib/WebService.ts
import * as http from 'http';
import * as fs from 'fs/promises';
import path from 'path';
import { marked } from 'marked';
import open from 'open'; // Use import for v8
import chalk from 'chalk';
import { FileSystem } from './FileSystem'; // Reuse FileSystem for reading

const DEFAULT_PORT = 4242; // Port "KaiKai" :)

export class WebService {
    private server: http.Server | null = null;
    private fsUtil: FileSystem;
    private projectRoot: string;

    constructor(projectRoot: string) {
        this.fsUtil = new FileSystem();
        this.projectRoot = projectRoot;
    }

    private async findFreePort(startPort: number): Promise<number> {
        let port = startPort;
        while (true) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const tester = http.createServer();
                    tester.once('error', (err: any) => {
                        if (err.code === 'EADDRINUSE') {
                            reject(err); // Port is busy
                        } else {
                            reject(err); // Other error
                        }
                    });
                    tester.once('listening', () => {
                        tester.close(() => resolve()); // Port is free
                    });
                    tester.listen(port, '127.0.0.1');
                });
                return port; // Found a free port
            } catch (err: any) {
                if (err.code === 'EADDRINUSE') {
                    console.log(chalk.dim(`Port ${port} is in use, trying next...`));
                    port++;
                    if (port > startPort + 100) { // Limit search range
                        throw new Error(`Could not find a free port near ${startPort}`);
                    }
                } else {
                    throw err; // Re-throw unexpected errors
                }
            }
        }
    }

    async showKanban(): Promise<void> {
        if (this.server && this.server.listening) {
            const currentPort = (this.server.address() as any).port;
            console.log(chalk.yellow(`Kanban server is already running at http://localhost:${currentPort}`));
            // Optionally open browser again or just return
            await open(`http://localhost:${currentPort}`);
            return;
        }

        const kanbanPath = path.resolve(this.projectRoot, 'Kanban.md');
        console.log(chalk.blue(`Reading Kanban board from: ${kanbanPath}`));

        let markdownContent: string;
        try {
            markdownContent = await this.fsUtil.readFile(kanbanPath) || '';
            if (!markdownContent) {
                console.error(chalk.red(`Error: Kanban.md file not found or is empty at ${kanbanPath}`));
                return;
            }
        } catch (error) {
            console.error(chalk.red(`Error reading Kanban.md file at ${kanbanPath}:`), error);
            return;
        }

        console.log(chalk.blue('Converting Markdown to HTML...'));
        let htmlContent: string;
        try {
            // Basic HTML structure with embedded CSS for slightly better readability
            const rawHtml = await marked.parse(markdownContent);
            htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kai Kanban Board</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; padding: 20px; max-width: 900px; margin: auto; background-color: #f8f9fa; color: #343a40; }
        h1, h2, h3 { border-bottom: 1px solid #dee2e6; padding-bottom: 0.3em; color: #0056b3; }
        h1 { font-size: 2em; }
        h2 { font-size: 1.5em; margin-top: 1.5em; }
        h3 { font-size: 1.2em; margin-top: 1.2em; }
        code { background-color: #e9ecef; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; }
        pre { background-color: #e9ecef; padding: 15px; border-radius: 5px; overflow-x: auto; }
        pre code { background-color: transparent; padding: 0; }
        ul, ol { margin-left: 20px; }
        li { margin-bottom: 0.5em; }
        strong { color: #28a745; }
        hr { border: 0; border-top: 1px solid #dee2e6; margin: 2em 0; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
        th, td { border: 1px solid #dee2e6; padding: 8px; text-align: left; }
        th { background-color: #e9ecef; }
    </style>
</head>
<body>
    ${rawHtml}
</body>
</html>`;
        } catch (error) {
            console.error(chalk.red('Error converting Markdown to HTML:'), error);
            return;
        }

        const port = await this.findFreePort(DEFAULT_PORT);

        this.server = http.createServer((req, res) => {
            console.log(chalk.dim(`Received request for: ${req.url}`));
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(htmlContent);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });

        this.server.listen(port, '127.0.0.1', async () => {
            const serverUrl = `http://localhost:${port}`;
            console.log(chalk.green(`Kanban server running at: ${serverUrl}`));
            console.log(chalk.yellow('Opening in your default browser...'));
            console.log(chalk.grey('(Server will keep running. Press Ctrl+C in this terminal to stop Kai and the server.)'));
            try {
                await open(serverUrl);
            } catch (error) {
                console.error(chalk.red(`Error opening browser:`), error);
                console.log(chalk.yellow(`Please open this URL manually: ${serverUrl}`));
            }
        });

        this.server.on('error', (err: NodeJS.ErrnoException) => {
            console.error(chalk.red(`Server error:`), err);
            this.server = null; // Reset server instance on error
        });
    }

    // Optional: Method to stop the server if needed later
    stopServer(): void {
        if (this.server) {
            console.log(chalk.blue('Stopping Kanban server...'));
            this.server.close(() => {
                console.log(chalk.green('Kanban server stopped.'));
                this.server = null;
            });
        }
    }
}