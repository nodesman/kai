#include "chatinterface.h"
#include "../../models/chatmodel.h"
#include <QVBoxLayout>
#include <QTextEdit>
#include <QLabel>
#include <QKeyEvent>
#include <QBrush> //Keep this for consistency
#include <QDebug>
#include <QScrollBar>
#include <QTextDocument>
#include "conversationhistory.h"
#include "promptentry.h"

ChatInterface::ChatInterface(QWidget *parent)
    : QWidget(parent)
      , chatModel(nullptr) {
    setupUI();
    //Don't do setModel, set the model on Mainwindow instead.
}

void ChatInterface::setupUI() {
    mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    conversationHistory = new ConversationHistory(this);

    promptInput = new PromptEntry(this);
    promptInput->setPlaceholderText("Type your prompt here. Press Ctrl+Enter (Cmd+Enter on macOS) to send.");
    promptInput->setStyleSheet("color: white; background-color: #2e2e2e; border: 1px solid #555;");
    // Darker, more consistent style

    statusBar = new QLabel("Ready", this);
    statusBar->setStyleSheet("background-color: #444; color: white; border: 1px solid #333;"); //Dark
    statusBar->setFixedHeight(25);

    QVBoxLayout *inputLayout = new QVBoxLayout;
    inputLayout->setContentsMargins(0, 0, 0, 0);
    inputLayout->setSpacing(0);
    inputLayout->addWidget(promptInput);
    inputLayout->addWidget(statusBar);

    QWidget *inputContainer = new QWidget(this);
    inputContainer->setLayout(inputLayout);

    mainLayout->addWidget(conversationHistory);
    mainLayout->addWidget(inputContainer);

    setLayout(mainLayout);
    // Removed the textChanged connection from here. It's now handled in PromptEntry.

    connect(promptInput, &PromptEntry::sendRequested, [this]() {
        if (promptInput->toPlainText().trimmed().isEmpty()) return;
        sendMessage(promptInput->toPlainText());
        promptInput->clear();
    });
}

void ChatInterface::setModel(ChatModel *model) {
    if (chatModel) {
        disconnect(chatModel, &ChatModel::requestPendingChanged, this, &ChatInterface::handleRequestPendingChanged);
        disconnect(chatModel, &QAbstractListModel::rowsInserted, conversationHistory,
                   &ConversationHistory::onRowsInserted); //Disconnect if it exists
    }

    chatModel = model;

    if (chatModel) {
        connect(chatModel, &ChatModel::requestPendingChanged, this, &ChatInterface::handleRequestPendingChanged);
        conversationHistory->setModel(chatModel); // Important: Set model for history
        updateChatHistory(); //Update UI
    }
}

void ChatInterface::handleRequestPendingChanged() {
    if (chatModel) {
        if (chatModel->requestPending())
            updateStatus("Waiting for response...");

        else
            updateStatus("Ready");
    }
}

void ChatInterface::updateStatus(const QString &statusMessage) {
    statusBar->setText(statusMessage);
}

void ChatInterface::updateChatHistory() {
    conversationHistory->updateHistory();
}