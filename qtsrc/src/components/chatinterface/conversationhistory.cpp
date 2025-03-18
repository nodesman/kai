#include "conversationhistory.h"

#include <iostream>
#include <QVBoxLayout>
#include <QTextCursor>
#include <QTextBlockFormat>
#include <QBrush>
#include <QFont>
#include <QTextFrame>
#include <QTextCharFormat>
#include <QDebug>
#include <QScrollBar>

ConversationHistory::ConversationHistory(QWidget *parent)
    : QWidget(parent)
    , chatModel(nullptr)
{
    qDebug() << "ConversationHistory constructor called";
    setupUI();
}

void ConversationHistory::setupUI() {
    QVBoxLayout *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);

    textEdit = new QTextEdit(this);
    textEdit->setReadOnly(true);
    textEdit->setStyleSheet("background-color: lightgrey; color: black; border: none;");
    textEdit->document()->setDocumentMargin(10);
    layout->addWidget(textEdit);
    setLayout(layout);
    qDebug() << "ConversationHistory UI setup complete";
}

void ConversationHistory::setModel(ChatModel *model) {
    qDebug() << "Setting model to ConversationHistory:" << (model ? "valid model" : "null model");

    if (chatModel) {
        disconnect(chatModel, &QAbstractItemModel::rowsInserted, this, &ConversationHistory::onRowsInserted);
        qDebug() << "Disconnected from previous model";
    }

    chatModel = model;

    if (chatModel) {
        qDebug() << "New model connected with" << chatModel->rowCount() << "rows";
        connect(chatModel, &QAbstractItemModel::rowsInserted, this, &ConversationHistory::onRowsInserted);
        updateHistory();
    }
}

void ConversationHistory::onRowsInserted(const QModelIndex &parent, int first, int last) {
    qDebug() << "Rows inserted into model: from" << first << "to" << last;
    updateHistory();
}

void ConversationHistory::updateHistory() {
    qDebug() << "updateHistory called";

    if (!chatModel) {
        qDebug() << "No chat model available, returning";
        return;
    }

    qDebug() << "Updating history with" << chatModel->rowCount() << "messages";
    textEdit->clear();
    QTextCursor cursor(textEdit->document());
    cursor.movePosition(QTextCursor::End);

    // Set document-wide properties
    QTextDocument *doc = textEdit->document();
    doc->setDocumentMargin(10);

    for (int i = 0; i < chatModel->rowCount(); ++i) {
        // Get data from the same column using the different roles
        QModelIndex index = chatModel->index(i, 0);

        qDebug() << "Message" << i << "index valid:" << index.isValid();
        qDebug() << "Available roles:" << chatModel->roleNames();

        // Try to get both values from the same index but different roles
        QVariant typeVariant = chatModel->data(index, ChatModel::MessageTypeRole);
        QVariant textVariant = chatModel->data(index, ChatModel::MessageTextRole);

        qDebug() << "Message" << i << "type valid:" << typeVariant.isValid()
                 << "text valid:" << textVariant.isValid();

        // Check if we have valid data
        if (!typeVariant.isValid() || !textVariant.isValid()) {
            qDebug() << "WARNING: Invalid data for message" << i;
            continue;
        }

        ChatModel::MessageType msgType = static_cast<ChatModel::MessageType>(typeVariant.toInt());
        QString msgText = textVariant.toString();

        qDebug() << "Message" << i << "- Type:" << (msgType == ChatModel::User ? "User" : "LLM")
                 << "- Text length:" << msgText.length()
                 << "- Text (first 30 chars):" << msgText.left(30);

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
            frameFormat.setBackground(QBrush(QColor("#f0f0e0")));
        }

        // Insert frame
        QTextFrame *frame = cursor.insertFrame(frameFormat);
        QTextCursor frameCursor = frame->firstCursorPosition();

        // Set text format
        QTextCharFormat textFormat;
        textFormat.setFont(QFont("Verdana", 12));
        frameCursor.setCharFormat(textFormat);
        


        if (msgText.isEmpty()) {
            qDebug() << "WARNING: Message text is empty for message" << i;
            msgText = "[Empty message]";
        }

        frameCursor.insertText(msgText.replace("\n", " "));

        // Move cursor after frame
        cursor = frame->lastCursorPosition();
        cursor.movePosition(QTextCursor::NextBlock);
    }

    // Scroll to end
    textEdit->verticalScrollBar()->setValue(textEdit->verticalScrollBar()->maximum());
    qDebug() << "History update complete";
}