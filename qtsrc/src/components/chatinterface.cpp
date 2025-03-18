#include "chatinterface.h"
#include "../models/chatmodel.h"
#include <QVBoxLayout>
#include <QTextEdit>
#include <QLabel>
#include <QKeyEvent>
#include <QTextCursor>
#include <QTextBlockFormat>
#include <QBrush>
#include <QFont>
#include <QDebug>
#include <QTimer>
#include <QSplitter> // Include QSplitter

ChatInterface::ChatInterface(QWidget *parent)
    : QWidget(parent)
    , chatModel(nullptr)
{
    setupUI();
}

void ChatInterface::setupUI() {
    mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    conversationHistory = new QTextEdit(this);
    conversationHistory->setReadOnly(true);
    conversationHistory->setStyleSheet("background-color: lightgrey; color: white;"); // Set text color here
    conversationHistory->document()->setDocumentMargin(0);

    promptInput = new QTextEdit(this);
    promptInput->setPlaceholderText("Type your prompt here. Press Ctrl+Enter (Cmd+Enter on macOS) to send.");
    promptInput->setStyleSheet("color: white;"); // Set text color

    statusBar = new QLabel("Ready", this);
    statusBar->setStyleSheet("background-color: lightblue; color: white;"); // Set text color
    statusBar->setFixedHeight(25); // Fixed height for the status bar

    // Create a QSplitter to manage the layout
    QSplitter *splitter = new QSplitter(Qt::Vertical, this); // Vertical splitter
    splitter->addWidget(conversationHistory);

    // Create a container widget for the prompt input and status bar
    QWidget *inputContainer = new QWidget(this);
    QVBoxLayout *inputLayout = new QVBoxLayout(inputContainer);
    inputLayout->setContentsMargins(0, 0, 0, 0);
    inputLayout->setSpacing(0); // No spacing between input and status bar
    inputLayout->addWidget(promptInput);
    inputLayout->addWidget(statusBar);
    inputContainer->setLayout(inputLayout);

    splitter->addWidget(inputContainer);
    splitter->setStretchFactor(0,1); //Make the top section take up as much of the splitter as possible
    splitter->setStretchFactor(1,0); // Do not let the second section stretch.

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
        // disconnect(chatModel, static_cast<void(QAbstractItemModel::*)(const QModelIndex &, int, int, const QList<int> &)>(&QAbstractItemModel::rowsInserted), this, &ChatInterface::updateConversationHistory);
        // disconnect(chatModel, &ChatModel::requestPendingChanged, this, &ChatInterface::handleRequestPendingChanged);
    }

    chatModel = model;

    if (chatModel) {
        // connect(chatModel, static_cast<void(QAbstractItemModel::*)(const QModelIndex &, int, int, const QList<int> &)>(&QAbstractItemModel::rowsInserted), this, &ChatInterface::updateConversationHistory);
        // connect(chatModel, &ChatModel::requestPendingChanged, this, &ChatInterface::handleRequestPendingChanged);
        updateConversationHistory();
        handleRequestPendingChanged();
    }
}

void ChatInterface::updateConversationHistory() {
    if (!chatModel) return;

    conversationHistory->clear();
    QTextCursor cursor(conversationHistory->document());
    cursor.movePosition(QTextCursor::End);

    for (int i = 0; i < chatModel->rowCount(); ++i) {
        QModelIndex typeIndex = chatModel->index(i, 0);
        QModelIndex textIndex = chatModel->index(i, 0);

        ChatModel::MessageType msgType = static_cast<ChatModel::MessageType>(chatModel->data(typeIndex, ChatModel::MessageTypeRole).toInt());
        QString msgText = chatModel->data(textIndex, ChatModel::MessageTextRole).toString();

        QTextBlockFormat blockFormat;
        blockFormat.setTopMargin(10);
        blockFormat.setBottomMargin(10);
        blockFormat.setLeftMargin(20);
        blockFormat.setRightMargin(20);

        if (msgType == ChatModel::User) {
            blockFormat.setBackground(QBrush(Qt::white));
            blockFormat.setRightMargin(25);
        } else {
            blockFormat.setBackground(QBrush(QColor(230, 230, 230)));
            blockFormat.setLeftMargin(25);
        }

        cursor.insertBlock(blockFormat);

        QTextCharFormat charFormat;
        charFormat.setFont(QFont("Arial", 12));
        charFormat.setForeground(QBrush(Qt::white)); // Set text color to white
        cursor.setCharFormat(charFormat);

        QString label = (msgType == ChatModel::User) ? "You: " : "LLM: ";
        cursor.insertText(label, charFormat);
        cursor.insertHtml(msgText.replace("\n", "<br>"));
    }
    cursor.movePosition(QTextCursor::End);
    conversationHistory->setTextCursor(cursor);
}

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
        chatModel->addMessage(ChatModel::User, promptText);
        promptInput->clear();
        chatModel->setRequestPending(true);
        QTimer::singleShot(2000, this, [this, promptText]() {
            if(chatModel){
                chatModel->addMessage(ChatModel::LLM, "Response to: " + promptText);
                chatModel->setRequestPending(false);
            }
        });
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