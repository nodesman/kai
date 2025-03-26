// File: src/lib/ReviewUIManager.ts
import blessed from 'blessed';
import chalk from 'chalk'; // Optional: for logging within the UI manager if needed

// --- Interface Definition (Exported directly here) ---
export type ReviewAction = 'CREATE' | 'MODIFY' | 'DELETE';
export interface ReviewDataItem {
    filePath: string;
    action: ReviewAction;
    diff: string; // Unified diff string
}
// --- End Interface Definition ---

class ReviewUIManager {
    private screen: blessed.Widgets.Screen;
    private fileListWidget: blessed.Widgets.ListElement;
    private diffBoxWidget: blessed.Widgets.Log; // Using Log for better scrolling/color support
    private reviewData: ReviewDataItem[];
    private selectedIndex: number = 0;

    // Store promise resolution functions
    private resolvePromise!: (value: boolean | PromiseLike<boolean>) => void;
    private rejectPromise!: (reason?: any) => void; // For potential future error handling within UI

    constructor(reviewData: ReviewDataItem[]) {
        if (!reviewData || reviewData.length === 0) {
            throw new Error("ReviewUIManager cannot be initialized with empty review data.");
        }
        this.reviewData = reviewData;

        // Create the screen instance
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Kai - Review Proposed Changes',
            fullUnicode: true, // Better character support, important for box drawing chars
            autoPadding: true, // Automatically add padding to elements
        });

        // Initialize widgets
        this.fileListWidget = this._createFileListWidget();
        this.diffBoxWidget = this._createDiffBoxWidget();

        // Append widgets to screen
        this.screen.append(this.fileListWidget);
        this.screen.append(this.diffBoxWidget);

        // Set up UI content and keybindings
        this._setupUI();
        this._setupKeybindings();
    }

    // Public method to start the UI and return the promise
    public run(): Promise<boolean> {
        // Create the promise that will be resolved when the user chooses Apply/Reject
        const decisionPromise = new Promise<boolean>((resolve, reject) => {
            this.resolvePromise = resolve;
            this.rejectPromise = reject;
        });

        // Initial rendering and focus
        this.fileListWidget.focus(); // Give focus to the list initially
        this._updateDiffView(this.selectedIndex); // Show initial diff
        this.screen.render(); // Render the screen

        return decisionPromise;
    }

    // --- Private UI Setup Methods ---

    private _createFileListWidget(): blessed.Widgets.ListElement {
        return blessed.list({
            parent: this.screen,
            label: ' Files (↑/↓ Select, a=Apply, r/q=Reject) ',
            top: 0,
            left: 0,
            width: '35%', // Approx 30-35% width
            height: '100%',
            border: 'line',
            style: {
                fg: 'white', // Text color
                bg: 'black', // Background color
                border: { fg: 'cyan' }, // Border color
                selected: { bg: 'blue', fg: 'white' }, // Style for the selected item
                item: { hover: { bg: 'blue' } } // Style on mouse hover
            },
            keys: true,   // Enable keyboard navigation (up, down)
            mouse: true,  // Enable mouse support (clicking, scrolling)
            vi: true,     // Enable vi keys (j, k) for navigation
            scrollable: true,
            alwaysScroll: true, // Show scrollbar even if content fits
            // --- Corrected scrollbar style ---
            scrollbar: {
                ch: ' ', // Character for the scrollbar track (use space)
                style: { inverse: true } // Style for the scrollbar thumb
            }
        });
    }

    private _createDiffBoxWidget(): blessed.Widgets.Log {
        // Using Log widget for potentially better scrolling and easier color handling via tags
        return blessed.log({
            parent: this.screen,
            label: ' Diff View ',
            top: 0,
            left: '35%', // Positioned next to the file list
            width: '65%',
            height: '100%',
            border: 'line',
            style: {
                fg: 'white',
                bg: 'black',
                border: { fg: 'cyan' }
            },
            scrollable: true,
            alwaysScroll: true,
            mouse: true, // Allow mouse scrolling
            tags: true, // IMPORTANT: Enable tag processing for colors ({red-fg} etc.)
            // --- Corrected scrollbar style ---
            scrollbar: {
                ch: ' ',
                style: { inverse: true }
            }
        });
    }

    private _setupUI(): void {
        // Format items for the list widget including color tags
        const listItems = this.reviewData.map(item => {
            let prefix = '';
            switch (item.action) {
                case 'CREATE': prefix = '{green-fg}[C]{/green-fg}'; break;
                case 'MODIFY': prefix = '{yellow-fg}[M]{/yellow-fg}'; break;
                case 'DELETE': prefix = '{red-fg}[D]{/red-fg}'; break;
            }
            // Use blessed.escape to prevent file paths with {} from being interpreted as tags
            return `${prefix} ${blessed.escape(item.filePath)}`;
        });

        this.fileListWidget.setItems(listItems);

        // Event listener for when an item is selected (by mouse click or enter key)
        this.fileListWidget.on('select item', (item, index) => {
            this.selectedIndex = index;
            this._updateDiffView(index);
        });

        // Listen for keypresses to update diff view during navigation
        // Using a timeout allows the list's internal state (like `selected`) to update *before* we query it
        this.fileListWidget.key(['up', 'down', 'k', 'j', 'pageup', 'pagedown', 'home', 'end'], () => {
            setTimeout(() => {
                // --- Corrected way to get selected index (using type assertion) ---
                // The blessed types might be inaccurate; .selected usually holds the index.
                const currentSelectedIndex = (this.fileListWidget as any).selected;
                if (typeof currentSelectedIndex === 'number' && currentSelectedIndex >= 0 && currentSelectedIndex !== this.selectedIndex) {
                    this.selectedIndex = currentSelectedIndex;
                    this._updateDiffView(this.selectedIndex);
                }
            }, 0); // Timeout 0ms allows the event loop to process the list update first
        });
    }

    private _setupKeybindings(): void {
        // Apply changes
        this.screen.key(['a'], () => this._handleApply());

        // Reject changes
        this.screen.key(['r', 'q', 'escape', 'C-c'], () => this._handleReject());

        // Allow focusing between panes (optional)
        // this.screen.key(['tab'], () => {
        //     if (this.screen.focused === this.fileListWidget) {
        //         this.diffBoxWidget.focus();
        //     } else {
        //         this.fileListWidget.focus();
        //     }
        // });
    }

    private _updateDiffView(index: number): void {
        if (index < 0 || index >= this.reviewData.length) {
            this.diffBoxWidget.setContent('{red-fg}Error: Invalid selection index.{/red-fg}');
            this.screen.render();
            return;
        }

        const selectedItem = this.reviewData[index];
        const diffLines = selectedItem.diff.split('\n');
        let coloredDiffContent = '';

        // Process lines for basic coloring using Blessed tags
        for (const line of diffLines) {
            // Escape the line content to prevent unintended tag interpretation
            const escapedLine = blessed.escape(line);
            if (line.startsWith('+') && !line.startsWith('+++')) {
                coloredDiffContent += `{green-fg}${escapedLine}{/green-fg}\n`;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                coloredDiffContent += `{red-fg}${escapedLine}{/red-fg}\n`;
            } else if (line.startsWith('@@')) {
                coloredDiffContent += `{cyan-fg}${escapedLine}{/cyan-fg}\n`; // Color hunk headers
            } else {
                coloredDiffContent += `${escapedLine}\n`; // Keep original color for context lines
            }
        }

        this.diffBoxWidget.setContent(coloredDiffContent); // Set content with color tags
        this.diffBoxWidget.setScrollPerc(0); // Scroll to top when content changes
        this.screen.render(); // Re-render the screen to show changes
    }

    // --- Private Action Handlers ---

    private _handleApply(): void {
        this._destroyScreen();
        this.resolvePromise(true); // Resolve promise with true for Apply
    }

    private _handleReject(): void {
        this._destroyScreen();
        this.resolvePromise(false); // Resolve promise with false for Reject
    }

    private _destroyScreen(): void {
        // Perform cleanup of the Blessed screen
        try {
            // --- Corrected check for screen destruction ---
            // Check if screen exists and *has not* already been destroyed
            if (this.screen && !(this.screen as any).destroyed) {
                this.screen.destroy();
                console.log(chalk.blue("Review UI closed.")); // Optional feedback
            }
        } catch (e) {
            // Log potential errors during destruction, though unlikely
            console.error(chalk.red("Error destroying Blessed screen:"), e);
        }
    }
}

// Export the class as the default
export default ReviewUIManager;