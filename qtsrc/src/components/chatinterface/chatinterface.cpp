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
        // Disconnect the requestPendingChanged signal from the old model.  We
        // still need this, since *this* class handles the status bar updates.
        disconnect(chatModel, &ChatModel::requestPendingChanged, this, &ChatInterface::handleRequestPendingChanged);
    }

    chatModel = model;

    if (chatModel) {
         // Connect to the new model.  We only need to connect to requestPendingChanged
        // here, as rowsInserted is handled by ConversationHistory.
        // connect(chatModel, &ChatModel::requestPendingChanged, this, &ChatInterface::handleRequestPendingChanged);
        conversationHistory->setModel(chatModel); // Pass the model to the component
        handleRequestPendingChanged(); // Update status
    }
}

// Remove updateConversationHistory.  It's now handled by ConversationHistory.

void ChatInterface::keyPressEvent(QKeyEvent *event) {
#ifdef Q_OS_MAC
    if (event->key() == Qt::Key_Return && event->modifiers() & Qt::MetaModifier) {
#else
    if (event->key() == Qt::Key_Return && event->modifiers() & Qt::ControlModifier) {
#endif
        emit sendMessage();
    }  else {
        QWidget::keyPressEvent(event);
    }
}

void ChatInterface::onSendPrompt() {
    QString promptText = promptInput->toPlainText();
    if (!promptText.isEmpty() && chatModel) {
        // chatModel->addMessage(ChatModel::User, promptText);
        // promptInput->clear();
        // chatModel->setRequestPending(true);
        // QTimer::singleShot(2000, this, [this, promptText]() {
        //     if(chatModel){
        //         chatModel->addMessage(ChatModel::LLM, "Response to: " + promptText);
        //         chatModel->setRequestPending(false);
        //     }
        // });
    }
}

void ChatInterface::handleRequestPendingChanged()
{
    if(chatModel)
    {
        // if(chatModel->requestPending())
        //     updateStatus("Waiting for response...");
        // else
        //     updateStatus("Ready");
    }
}

void ChatInterface::updateStatus(const QString &statusMessage)
{
    statusBar->setText(statusMessage);
}