#include "conversationhistory.h"

#include <iostream>
#include <QVBoxLayout>
#include <QTextCursor>
#include <QTextBlockFormat>
#include <QBrush>
#include <QFont>
#include <QTextFrame>
#include <QScrollBar>

ConversationHistory::ConversationHistory(QWidget *parent)
    : QWidget(parent)
    , chatModel(nullptr)
{
    setupUI();
}

void ConversationHistory::setupUI() {
    QVBoxLayout *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);

    textEdit = new QTextEdit(this);
    textEdit->setReadOnly(true);
    textEdit->setStyleSheet("background-color: lightgrey; color: black; border: none;");
    textEdit->document()->setDocumentMargin(10); // Add some padding around the entire document
    layout->addWidget(textEdit);
    setLayout(layout);
}

void ConversationHistory::setModel(ChatModel *model) {
    if (chatModel) {
        disconnect(chatModel, &QAbstractItemModel::rowsInserted, this, &ConversationHistory::onRowsInserted);
    }

    chatModel = model;

    if (chatModel) {
        connect(chatModel, &QAbstractItemModel::rowsInserted, this, &ConversationHistory::onRowsInserted);
        updateHistory();
    }
}

void ConversationHistory::onRowsInserted(const QModelIndex & /*parent*/, int /*first*/, int /*last*/) {
    updateHistory();
}

void ConversationHistory::updateHistory() {
    if (!chatModel) return;

    textEdit->clear();
    QTextCursor cursor(textEdit->document());
    cursor.movePosition(QTextCursor::End);

    // Set document-wide properties
    QTextDocument *doc = textEdit->document();
    doc->setDocumentMargin(10);

    for (int i = 0; i < chatModel->rowCount(); ++i) {
        QModelIndex typeIndex = chatModel->index(i, 0);
        QModelIndex textIndex = chatModel->index(i, 1);

        ChatModel::MessageType msgType = static_cast<ChatModel::MessageType>(chatModel->data(typeIndex, ChatModel::MessageTypeRole).toInt());
        QString msgText = chatModel->data(textIndex, ChatModel::MessageTextRole).toString();

        // Insert block with proper spacing
        QTextBlockFormat blockFormat;
        blockFormat.setBottomMargin(10); // Space between messages

        if (i > 0) {
            cursor.insertBlock(blockFormat);
        }

        // Message alignment
        blockFormat = QTextBlockFormat();
        if (msgType == ChatModel::User) {
            blockFormat.setAlignment(Qt::AlignRight);
        } else {
            blockFormat.setAlignment(Qt::AlignLeft);
        }
        cursor.setBlockFormat(blockFormat);

        // Message frame format
        QTextFrameFormat frameFormat;
        frameFormat.setBorder(1);
        frameFormat.setBorderStyle(QTextFrameFormat::BorderStyle_Solid);
        frameFormat.setBorderBrush(QBrush(QColor("#cccccc")));
        frameFormat.setPadding(20);

        // Set max width using appropriate margins
        if (msgType == ChatModel::User) {
            frameFormat.setRightMargin(20);
            frameFormat.setLeftMargin(40);
            frameFormat.setBackground(QBrush(Qt::white));
        } else {
            frameFormat.setLeftMargin(20);
            frameFormat.setRightMargin(40);
            frameFormat.setBackground(QBrush(QColor("#f0f0e0")));  // Light beige for LLM messages
        }

        // Insert frame
        QTextFrame *frame = cursor.insertFrame(frameFormat);
        QTextCursor frameCursor = frame->firstCursorPosition();

        // Set text format
        QTextCharFormat textFormat;
        textFormat.setFont(QFont("Verdana", 12));
        frameCursor.setCharFormat(textFormat);

        // Insert label and message
        QString label = (msgType == ChatModel::User) ? "You: " : "LLM: ";
        frameCursor.insertText(label);
        frameCursor.insertText(msgText.replace("\n", " "));

        // Move cursor after frame
        cursor = frame->lastCursorPosition();
        cursor.movePosition(QTextCursor::NextBlock);
    }

    // Scroll to end
    textEdit->verticalScrollBar()->setValue(textEdit->verticalScrollBar()->maximum());
}