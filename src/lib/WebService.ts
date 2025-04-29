// src/lib/WebService.ts
import * as http from 'http';
import * as fs from 'fs/promises';
import path from 'path';
import { marked } from 'marked';
import open from 'open'; // Use import for v8
import chalk from 'chalk';
import { FileSystem } from './FileSystem'; // Reuse FileSystem for reading

// Define structure for parsed sections
interface KanbanSection {
    type: 'kanban-board' | 'principles' | 'epics' | 'other';
    title: string; // e.g., "Backlog", "Guiding Principles", "Epics & Features"
    content: string; // Raw markdown content of the section
}

interface KanbanColumn {
    title: string;
    content: string; // HTML content for the column cards
}
const DEFAULT_PORT = 4242; // Port "KaiKai" :)

export class WebService {
    private server: http.Server | null = null;
    private fsUtil: FileSystem;
    private projectRoot: string;

    constructor(projectRoot: string) {
        this.fsUtil = new FileSystem();
        this.projectRoot = projectRoot;
    }

    /**
     * Parses the Kanban Markdown into structured columns.
     * @param markdownContent The raw Markdown content of Kanban.md.
     * @returns An array of objects, each representing a column with its title and markdown content.
     */
    private parseKanbanColumns(markdownContent: string): KanbanColumn[] {
        const lines = markdownContent.split('\n');
        const columns: KanbanColumn[] = [];
        let currentColumn: { title: string; content: string } | null = null;

        for (const line of lines) {
            if (line.startsWith('## ')) {
                // Start new column
                const title = line.substring(3).trim();
                currentColumn = { title: title, content: '' }; // Store raw markdown here
                columns.push(currentColumn);
            } else if (currentColumn) {
                // Append line to the content of the current column
                currentColumn.content += line + '\n';
            }
        }
        // Trim and parse markdown content to HTML for each column AFTER gathering all lines
        columns.forEach(col => {
            col.content = col.content.trimEnd();
            // Note: Marked parsing will happen when generating the final HTML
        });

        return columns;
    }

     /**
     * Parses the entire Kanban.md into distinct sections based on H2 headers or specific titles.
     * @param markdownContent The raw Markdown content of Kanban.md.
     * @returns An array of parsed sections.
     */
    private parseKanbanSections(markdownContent: string): KanbanSection[] {
        const sections: KanbanSection[] = [];
        const lines = markdownContent.split('\n');
        let currentSection: KanbanSection | null = null;

        for (const line of lines) {
            // Look for H1 or H2 headers to define sections
            const h1Match = line.match(/^#\s+(.*)/);
            const h2Match = line.match(/^##\s+(.*)/);
            const titleMatch = h1Match || h2Match;

            if (titleMatch) {
                const title = titleMatch[1].trim();
                let type: KanbanSection['type'] = 'other'; // Default to other

                // Check for specific titles or column headers
                if (['Backlog (To Do)', 'In Progress', 'Done'].includes(title)) {
                    type = 'kanban-board';
                } else if (title === 'Guiding Principles') {
                    type = 'principles';
                } else if (title === 'Epics & Features') {
                    type = 'epics';
                }
                // Create a new section
                currentSection = { title, content: '', type };
                sections.push(currentSection);
            } else if (currentSection) {
                // Append content to the current section
                currentSection.content += line + '\n';
            }
        }
        // Trim trailing newline from each section's content
        sections.forEach(sec => sec.content = sec.content.trimEnd());
        return sections;
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
            // Removed automatic opening
            console.log(chalk.yellow(`Click the link above to view the board.`));
            // await open(`http://localhost:${currentPort}`); // Don't open if already running
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
        let kanbanBoardHtml = ''; // HTML for the Kanban Board columns
        let principlesHtml = ''; // HTML for the Guiding Principles section
        let epicsHtml = ''; // HTML for the Epics & Features section

        try {
            // Parse the markdown into logical sections
            const sections = this.parseKanbanSections(markdownContent);

            // Process sections into their respective HTML parts
            for (const section of sections) {
                if (section.type === 'kanban-board') {
                    // For board columns, parse the content to HTML now
                    const columnContentHtml = await marked.parse(section.content);
                    kanbanBoardHtml += `
            <div class="kanban-column">
                <h2>${section.title}</h2>
                <div class="kanban-column-content">
                    ${columnContentHtml}
                </div>
            </div>`;
                } else if (section.type === 'principles') {
                    principlesHtml = await marked.parse(section.content);
                } else if (section.type === 'epics') {
                    epicsHtml = await marked.parse(section.content);
                }
                // Ignore 'other' sections for now
            }

             // --- Fallback if specific sections weren't found (optional, for robustness) ---
            if (!kanbanBoardHtml && !principlesHtml && !epicsHtml) {
                console.warn(chalk.yellow("Could not parse specific sections (Kanban, Principles, Epics). Rendering entire Markdown as a single board."));
                 // Simple fallback: treat the whole thing as one big column (or render raw markdown)
                 // For simplicity, let's just render the raw markdown in the first tab in this edge case.
                 kanbanBoardHtml = `<div class="kanban-column"><h2>Fallback Content</h2><div class="kanban-column-content">${await marked.parse(markdownContent)}</div></div>`;
            } else {
                 // Ensure there's at least *some* content in the main board tab if others are missing
                 if (!kanbanBoardHtml) kanbanBoardHtml = "<p>No standard Kanban columns found.</p>";
            }

            // Basic HTML structure with embedded CSS for slightly better readability
            // Updated CSS for Kanban layout
            htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kai Project Dashboard</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; padding: 20px; max-width: 1400px; /* Wider max-width */ margin: auto; background-color: #f8f9fa; color: #343a40; }
        h1, h2, h3 { border-bottom: 1px solid #dee2e6; padding-bottom: 0.3em; color: #0056b3; }
        h1 { font-size: 2em; }
        h2 { font-size: 1.5em; margin-top: 1.5em; }
        h3 { font-size: 1.2em; margin-top: 1.2em; }
        code { background-color: #e9ecef; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; }
        pre { background-color: #e9ecef; padding: 15px; border-radius: 5px; overflow-x: auto; }
        pre code { background-color: transparent; padding: 0; }
        ul, ol { margin-left: 20px; padding-left: 0; } /* Adjusted padding */
        li { margin-bottom: 0.5em; }
        strong { color: #28a745; } /* Keep green for emphasis */
        /* Make bold elements stand out more */
        b, strong { font-weight: 600; color: #196f3d; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
        th, td { border: 1px solid #dee2e6; padding: 8px; text-align: left; }
        th { background-color: #e9ecef; }

        /* Tab Styles */
        .tab-container { overflow: hidden; border: 1px solid #ccc; background-color: #f1f1f1; border-radius: 8px 8px 0 0; margin-top: 20px; }
        .tab-container button { background-color: inherit; float: left; border: none; outline: none; cursor: pointer; padding: 14px 16px; transition: 0.3s; font-size: 1em; border-right: 1px solid #ccc; }
        .tab-container button:last-child { border-right: none; }
        .tab-container button:hover { background-color: #ddd; }
        .tab-container button.active { background-color: #ccc; font-weight: bold; }

        .tab-content { display: none; padding: 15px 12px; border: 1px solid #ccc; border-top: none; background-color: #fff; border-radius: 0 0 8px 8px; min-height: 400px; /* Ensure content area has height */ }
        /* Specific styling for the Kanban Board tab content */
        #KanbanBoard {
             padding: 0; /* Remove padding if the board itself has it */
             border: none; /* Remove border if the board itself has it */
             background-color: transparent; /* Use body background */
        }

        /* Ensure content within non-board tabs is styled normally */
        #GuidingPrinciples, #EpicsFeatures {
             background-color: #fff; /* White background for text content */
             border: 1px solid #ccc;
             border-top: none;
             border-radius: 0 0 8px 8px;
             padding: 15px 12px;
        }
        /* Styling for lists within Principles and Epics */
        #GuidingPrinciples ul, #EpicsFeatures ul { list-style: disc; margin-left: 20px; }
        #GuidingPrinciples li, #EpicsFeatures li { margin-bottom: 0.8em; background-color: transparent; border: none; box-shadow: none; padding: 0; }
        #GuidingPrinciples li p, #EpicsFeatures li p { margin: 0 0 0.3em 0; } /* Minor spacing below paragraphs in lists */

        /* Kanban Styles */
        .kanban-board {
            display: flex;
            gap: 15px; /* Space between columns */
            overflow-x: auto; /* Allow horizontal scrolling if needed */
            padding-bottom: 15px; /* Space for scrollbar */
            /* Removed top border */
            margin-top: 0; /* Removed top margin */
        }
        #KanbanBoard .kanban-column { /* Target columns only within the board tab */
            flex: 1; /* Each column takes equal space */
            min-width: 280px; /* Minimum width for readability */
            max-width: 450px; /* Max width to prevent excessive stretching */
            background-color: #e9ecef; /* Light grey background */
            border-radius: 8px;
            padding: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            /* Add height and overflow for scrolling within columns */
            height: calc(100vh - 200px); /* Adjust height based on viewport minus header/tabs */
            overflow-y: auto;
        }
        #KanbanBoard .kanban-column h2 { margin-top: 0; font-size: 1.3em; color: #495057; border-bottom: 1px solid #ced4da; position: sticky; top: 0; background-color: #e9ecef; padding-bottom: 5px; z-index: 1; } /* Sticky header */
        #KanbanBoard .kanban-column-content ul { list-style: none; padding: 0; margin: 0; }
        #KanbanBoard .kanban-column-content li { background-color: #fff; border: 1px solid #dee2e6; border-radius: 4px; padding: 10px; margin-bottom: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        #KanbanBoard .kanban-column-content li p { margin: 0 0 0.5em 0; } /* Add some space below paragraphs within cards */
         #KanbanBoard .kanban-column-content li > strong { display: block; margin-bottom: 0.3em; font-size: 1.05em; } /* Style the task title */
         #KanbanBoard .kanban-column-content li > ul { margin-top: 0.5em; padding-left: 15px; } /* Indent sub-bullets (details) */
         #KanbanBoard .kanban-column-content li > ul li { background: none; border: none; box-shadow: none; padding: 0; margin-bottom: 0.2em; font-size: 0.95em; } /* Style sub-bullets */

        /* Clear floats after the tabs */
        .tab-container::after { content: ""; display: table; clear: both; }
    </style>
</head>
<body>
    <h1>Kai Project Dashboard</h1>

    <!-- Tab links -->
    <div class="tab-container">
        <button class="tab-button active" onclick="openTab(event, 'KanbanBoard')">Kanban Board</button>
        <button class="tab-button" onclick="openTab(event, 'EpicsFeatures')">Epics & Features</button>
        <button class="tab-button" onclick="openTab(event, 'GuidingPrinciples')">Guiding Principles</button>
    </div>

    <!-- Tab content -->
    <div id="KanbanBoard" class="tab-content" style="display: block;">
        <div class="kanban-board">
             ${kanbanBoardHtml}
        </div>
    </div>

    <div id="EpicsFeatures" class="tab-content">
        ${epicsHtml || "<p>Epics & Features section not found in Kanban.md</p>"}
    </div>

    <div id="GuidingPrinciples" class="tab-content">
        ${principlesHtml || "<p>Guiding Principles section not found in Kanban.md</p>"}
    </div>

    <script>
        function openTab(evt, tabName) {
            var i, tabcontent, tabbuttons;
            tabcontent = document.getElementsByClassName("tab-content");
            for (i = 0; i < tabcontent.length; i++) { tabcontent[i].style.display = "none"; }
            tabbuttons = document.getElementsByClassName("tab-button");
            for (i = 0; i < tabbuttons.length; i++) { tabbuttons[i].className = tabbuttons[i].className.replace(" active", ""); }
            document.getElementById(tabName).style.display = "block";
            evt.currentTarget.className += " active";
        }
    </script>
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
            // Removed automatic opening
            console.log(chalk.yellow(`Click the link above to view the board.`));
            console.log(chalk.grey('(Server will keep running. Press Ctrl+C in this terminal to stop Kai and the server.)'));
            // Removed try-catch block for open()
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