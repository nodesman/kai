#include "chatinterface.h"
#include "../../models/chatmodel.h"
#include <QVBoxLayout>
#include <QTextEdit>
#include <QLabel>
#include <QKeyEvent>
#include <QTextCursor>
#include <QTextBlockFormat> //Keep this for consistency
#include <QBrush> //Keep this for consistency
#include <QFont> //Keep this for consistency
#include <QDebug>
#include <QTimer>
#include <QSplitter>

#include "conversationhistory.h"

ChatInterface::ChatInterface(QWidget *parent)
    : QWidget(parent)
    , chatModel(nullptr)
{
    setupUI();
}

void ChatInterface::setupUI() {
    mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    // Use the ConversationHistory component
    conversationHistory = new ConversationHistory(this);

    promptInput = new QTextEdit(this);
    promptInput->setPlaceholderText("Type your prompt here. Press Ctrl+Enter (Cmd+Enter on macOS) to send.");
    promptInput->setStyleSheet("color: white;");

    statusBar = new QLabel("Ready", this);
    statusBar->setStyleSheet("background-color: lightblue; color: white;");
    statusBar->setFixedHeight(25);

    QSplitter *splitter = new QSplitter(Qt::Vertical, this);
    splitter->addWidget(conversationHistory); // Add the component

    QWidget *inputContainer = new QWidget(this);
    QVBoxLayout *inputLayout = new QVBoxLayout(inputContainer);
    inputLayout->setContentsMargins(0, 0, 0, 0);
    inputLayout->setSpacing(0);
    inputLayout->addWidget(promptInput);
    inputLayout->addWidget(statusBar);
    inputContainer->setLayout(inputLayout);

    splitter->addWidget(inputContainer);
    splitter->setStretchFactor(0, 1);
    splitter->setStretchFactor(1, 0);

    mainLayout->addWidget(splitter);
    setLayout(mainLayout);

    connect(promptInput, &QTextEdit::textChanged, this, [this]() {
        QTextDocument *doc = promptInput->document();
        doc->setTextWidth(promptInput->width());
        qreal newHeight = doc->size().height() + 10;
        QFontMetrics metrics(promptInput->font());
        qreal maxHeight = metrics.lineSpacing() * 10;
    });

    connect(this, &ChatInterface::sendMessage, this, &ChatInterface::onSendPrompt);
}

void ChatInterface::setModel(ChatModel *model) {
    if (chatModel) {
        // Disconnect the requestPendingChanged signal from the old model.
        disconnect(chatModel, &ChatModel::requestPendingChanged, this, &ChatInterface::handleRequestPendingChanged);
    }

    chatModel = model;

    if (chatModel) {
        // Connect to the new model.
        connect(chatModel, &ChatModel::requestPendingChanged, this, &ChatInterface::handleRequestPendingChanged);
        conversationHistory->setModel(chatModel); // Pass the model to the component
        handleRequestPendingChanged(); // Update status, reflecting the initial state
    }
}

void ChatInterface::keyPressEvent(QKeyEvent *event) {

    if (event->key() == Qt::Key_Return && event->modifiers() & Qt::ControlModifier) {
        //  Emit sendMessage regardless of pending state. Node.js decides.
        emit sendMessage(promptInput->toPlainText());
        promptInput->clear(); // Clear the input *after* emitting the signal
    }  else {
        QWidget::keyPressEvent(event);
    }
}

void ChatInterface::onSendPrompt(const QString &message) {
     // Do nothing else here.  We've already sent the message.
    if (chatModel) {
        chatModel->addMessage(ChatModel::User, message); // Add to chat history
        // Don't touch requestPending here!
    }
}

void ChatInterface::handleRequestPendingChanged()
{
    if(chatModel)
    {
        if(chatModel->requestPending())
            updateStatus("Waiting for response...");
        else
            updateStatus("Ready");
    }
}

void ChatInterface::updateStatus(const QString &statusMessage)
{
    statusBar->setText(statusMessage);
}