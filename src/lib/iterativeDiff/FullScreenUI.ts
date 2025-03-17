// lib/FullScreenUI.js
import blessed from 'blessed';
import contrib from 'blessed-contrib';

class FullScreenUI {
    constructor() {
        this.screen = blessed.screen({ smartCSR: true });
        this.screen.title = 'Kai - Code Review';

        this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

        // Left Pane (Prompting and History)
        this.leftPane = this.grid.set(0, 0, 12, 6, blessed.box, {
            label: 'Prompting and History',
            border: 'line',
        });

        this.promptHistoryBox = this.grid.set(1, 1, 10, 4, blessed.scrollablebox, {
            content: '> Previous Prompts:\n  (History...)', // Placeholder content
        });


        this.currentPromptBox = this.grid.set(0, 0, 1, 6, blessed.box, {
            content: '> Current Prompt: Increase width of Submit button by 10px',
        });

        this.inputBox = this.grid.set(11, 0, 1, 6, blessed.textbox, {
            inputOnFocus: true, // Let the user type immediately
        });



        // Right Pane (File Changes and Diffs)
        this.rightPane = this.grid.set(0, 6, 12, 6, blessed.box,
            { label: 'File Changes and Diffs', border: 'line' }
        );

        this.fileList = this.grid.set(0, 6, 6, 6, blessed.list, {
            items: [
                'File 1: src/components/Button.js (Modified)',
                'File 2: src/components/Form.js (Modified)',
                'File 3: src/styles/main.css (Added)'
            ],
            border: 'line',
            interactive: true,
            keys: true,
            vi: true,
            mouse: true,
        });


        this.diffBox = this.grid.set(6, 6, 6, 6, blessed.scrollablebox, {
            content: '--- a/src/components/Form.js\n+++ b/src/components/Form.js', // Placeholder
            alwaysScroll: true,
            scrollable: true,
            border: 'line',
        });

        this.screen.key(['q', 'C-c'], () => {
            process.exit(0);
        });


        this.screen.render();

    }

    show() {
        this.screen.render();
    }
}

export default FullScreenUI;