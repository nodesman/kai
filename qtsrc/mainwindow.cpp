#include "mainwindow.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton> // ADDED: Include for QPushButton

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setupUI();
    createSampleDiff(); // Added to show something on startup
}

MainWindow::~MainWindow()
{
}

void MainWindow::setupUI()
{
    // --- Main Window Setup ---
    this->setWindowTitle("LLM Chat Interface");
    this->resize(800, 600); // Set initial window size

    // --- Create Widgets ---
    conversationHistory = new QTextEdit(this);
    conversationHistory->setReadOnly(true); // Conversation history is read-only
    promptInput = new QLineEdit(this);
    llmResponse = new QTextEdit(this);
    llmResponse->setReadOnly(true);

    // --- Left Splitter (Conversation History and Prompt Input) ---
    leftSplitter = new QSplitter(Qt::Vertical, this); // Vertical split
    leftSplitter->addWidget(conversationHistory);

    // --- Original Code (To be visualized as REMOVED) ---
    // leftSplitter->addWidget(promptInput);

    // --- Modified Code (To be visualized as ADDED) ---
    // We create a horizontal layout for main input area (prompt and send)
    QHBoxLayout *inputLayout = new QHBoxLayout;
    inputLayout->addWidget(promptInput); // prompt input to the layout

    QPushButton *sendButton = new QPushButton("Send", this); // Added send button.
    inputLayout->addWidget(sendButton);

    QWidget* inputWidget = new QWidget(); //A widget to hold the horizontal layout
    inputWidget->setLayout(inputLayout);
    leftSplitter->addWidget(inputWidget);

    // --- End of Modified Code ---

    leftSplitter->setStretchFactor(0, 1); // 80% for conversationHistory
    leftSplitter->setStretchFactor(1, 1); // 20% for promptInput

    // --- Main Splitter (Left and Right Halves) ---
    mainSplitter = new QSplitter(Qt::Horizontal, this); // Horizontal split
    mainSplitter->addWidget(leftSplitter);
    //mainSplitter->addWidget(llmResponse); //Replaced with diff view
     diffView = new DiffView(this); // ADDED
     mainSplitter->addWidget(diffView);

    mainSplitter->setStretchFactor(0, 1);  // Equal width for both halves
    mainSplitter->setStretchFactor(1, 1);

    // --- Set Central Widget ---
    this->setCentralWidget(mainSplitter);

    // --- Connections ---  // Added section for signal/slot connections
    connect(promptInput, &QLineEdit::returnPressed, this, &MainWindow::sendPrompt);
    connect(sendButton, &QPushButton::clicked, this, &MainWindow::sendPrompt);
}

// --- Added sendPrompt function ---
void MainWindow::sendPrompt()
{
  QString promptText = promptInput->text();
    if (!promptText.isEmpty()) {
        conversationHistory->append("You: " + promptText);
        promptInput->clear();

        // Simulate LLM response (replace with actual LLM interaction)
        llmResponse->append("LLM: Thinking...");
        // ... (In a real application, you would send the prompt to the LLM here)
    }

}
void MainWindow::createSampleDiff()
{
     QList<DiffView::DiffLine> diffData;
     diffData.append({"This is an unchanged line.", DiffView::Unchanged});
     diffData.append({"This line was removed.", DiffView::Removed});
     diffData.append({"This line was added.", DiffView::Added});
     diffData.append({"Another unchanged line.", DiffView::Unchanged});
     diffData.append({"Another added line.", DiffView::Added});
     diffData.append({"Another removed line.", DiffView::Removed});
     diffData.append({"Unchanged.", DiffView::Unchanged});
     diffData.append({"Unchanged.", DiffView::Unchanged});
      diffData.append({"Added", DiffView::Added});
     diffData.append({"Unchanged.", DiffView::Unchanged});

     diffView->setDiffData(diffData);

}
