// mainwindow.cpp
#include "mainwindow.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton>
#include <QListView>       // For the file list
#include "../models/diffmodel.h"    // For the DiffModel


MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setupUI();
    // createSampleDiff(); // REMOVED: We use the model now
}

MainWindow::~MainWindow()
{
}

void MainWindow::setupUI()
{
    // --- Main Window Setup ---
    this->setWindowTitle("LLM Chat Interface");
    this->resize(800, 600);

    // --- Create Widgets ---
    conversationHistory = new QTextEdit(this);
    conversationHistory->setReadOnly(true);
    promptInput = new QLineEdit(this);
    // llmResponse = new QTextEdit(this); // REMOVED
    // llmResponse->setReadOnly(true);

    // --- Left Splitter (Conversation History and Prompt Input) ---
    leftSplitter = new QSplitter(Qt::Vertical, this);
    leftSplitter->addWidget(conversationHistory);

    QHBoxLayout *inputLayout = new QHBoxLayout;
    inputLayout->addWidget(promptInput);

    QPushButton *sendButton = new QPushButton("Send", this);
    inputLayout->addWidget(sendButton);

    QWidget* inputWidget = new QWidget();
    inputWidget->setLayout(inputLayout);
    leftSplitter->addWidget(inputWidget);

    leftSplitter->setStretchFactor(0, 1);
    leftSplitter->setStretchFactor(1, 1);

    // --- Main Splitter (Left and Right Halves) ---
    mainSplitter = new QSplitter(Qt::Horizontal, this);
    mainSplitter->addWidget(leftSplitter);

    // --- Diff View and Model ---
    diffView = new DiffView(this);
    diffModel = new DiffModel(this); // Create the model
    diffView->setModel(diffModel);     // Connect the view to the model
    mainSplitter->addWidget(diffView);


    mainSplitter->setStretchFactor(0, 1);
    mainSplitter->setStretchFactor(1, 1);

    // --- Set Central Widget ---
    this->setCentralWidget(mainSplitter);

    // --- Connections ---
    connect(promptInput, &QLineEdit::returnPressed, this, &MainWindow::sendPrompt);
    connect(sendButton, &QPushButton::clicked, this, &MainWindow::sendPrompt);

    // --- Placeholder Data (Example) ---  // MOVED to a separate function
    populatePlaceholderData();
}

void MainWindow::sendPrompt() {
    QString promptText = promptInput->text();
    if (!promptText.isEmpty()) {
        conversationHistory->append("You: " + promptText);
        promptInput->clear();

        // --- Simulate receiving data from Node.js (Replace with actual IPC) ---
        // In a real application, this is where you'd send the prompt to Node.js
        // and receive the response (including the file list and colorized content).
        // For this example, we're just using placeholder data.

        // --- Simulate receiving an "updateDiff" message ---
        // (Replace this with your actual IPC mechanism)
        // Assume this data comes from Node.js after processing the prompt.
        QStringList filePaths = {
            "src/components/Form.js",
            "src/components/Button.js"
        };

        QList<QString> fileContents;
        fileContents <<
            "+import styles from './Form.module.css';\n"
            "  import React from 'react';\n"
            "\n"
            "  const Form = () => {\n"
            "-    return (\n"
            "+    return ( // No style\n"
            "+        <form className={styles.form}>\n"
            "          <label htmlFor=\"name\">Name:</label>\n"
            "          <input type=\"text\" id=\"name\" name=\"name\" />\n"
            "-         <button>Submit</button>\n"
            "+         <button className={styles.button}>Submit</button>\n"
            "+        </form> // Added form\n"
            "      );\n"
            "  };\n"
            "\n"
            "  export default Form;\n";

        fileContents <<
            "  import React from 'react';\n"
            "\n"
            "  const Button = () => {\n"
            "+    return <button>Click Me!</button>;\n"
            "  };\n"
            "\n"
            "  export default Button;\n";
        diffModel->setFiles(filePaths, fileContents);

    }
}

void MainWindow::populatePlaceholderData() {
    // This function is now used to populate initial placeholder data.
    QStringList filePaths = {
        "src/components/Form.js",
        "src/components/Button.js"
    };

    QList<QString> fileContents; //create placeholder content.
    fileContents <<
        "+import styles from './Form.module.css';\n"
        "  import React from 'react';\n"
        "\n"
        "  const Form = () => {\n"
        "-    return (\n"
        "+    return ( // No style\n"
        "+        <form className={styles.form}>\n"
        "          <label htmlFor=\"name\">Name:</label>\n"
        "          <input type=\"text\" id=\"name\" name=\"name\" />\n"
        "-         <button>Submit</button>\n"
        "+         <button className={styles.button}>Submit</button>\n"
        "+        </form> // Added form\n"
        "      );\n"
        "  };\n"
        "\n"
        "  export default Form;\n";

    fileContents <<
        "  import React from 'react';\n"
        "\n"
        "  const Button = () => {\n"
        "+    return <button>Click Me!</button>;\n"
        "  };\n"
        "\n"
        "  export default Button;\n";

    diffModel->setFiles(filePaths, fileContents);
}