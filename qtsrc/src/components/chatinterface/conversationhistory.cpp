#include "conversationhistory.h"
#include <QVBoxLayout>
#include <QTextCursor>
#include <QTextBlockFormat>
#include <QBrush>
#include <QFont>

ConversationHistory::ConversationHistory(QWidget *parent)
    : QWidget(parent)
    , chatModel(nullptr) // Initialize chatModel
{
    setupUI();
}

void ConversationHistory::setupUI() {
    QVBoxLayout *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0); // Remove margins

    textEdit = new QTextEdit(this);
    textEdit->setReadOnly(true);
    textEdit->setStyleSheet("background-color: lightgrey; color: white;"); // Consistent styling
    textEdit->document()->setDocumentMargin(0);
    layout->addWidget(textEdit);
    setLayout(layout);
}

void ConversationHistory::setModel(ChatModel *model) {
    if (chatModel) {
        // Disconnect from the old model
        disconnect(chatModel, &QAbstractItemModel::rowsInserted, this, &ConversationHistory::onRowsInserted);
    }

    chatModel = model;

    if (chatModel) {
        // Connect to the new model
        // connect(chatModel, static_cast<void(QAbstractItemModel::*)(const QModelIndex &, int, int, const QList<int> &)>(&QAbstractItemModel::rowsInserted), this, &ConversationHistory::onRowsInserted);
        updateHistory(); // Initial update
    }
}

void ConversationHistory::onRowsInserted(const QModelIndex & /*parent*/, int /*first*/, int /*last*/) {
    updateHistory(); // Re-render on any row insertion
}
void ConversationHistory::updateHistory()
{
    if (!chatModel) return;

     textEdit->clear();
    QTextCursor cursor(textEdit->document());
    cursor.movePosition(QTextCursor::End);

    for (int i = 0; i < chatModel->rowCount(); ++i) {
        QModelIndex typeIndex = chatModel->index(i, 0);
        QModelIndex textIndex = chatModel->index(i, 0);

        ChatModel::MessageType msgType = static_cast<ChatModel::MessageType>(chatModel->data(typeIndex, ChatModel::MessageTypeRole).toInt());
        QString msgText = chatModel->data(textIndex, ChatModel::MessageTextRole).toString();

        // --- Styling the message box ---
        QTextBlockFormat blockFormat;
        blockFormat.setTopMargin(10);
        blockFormat.setBottomMargin(10); // Spacing *between* message boxes
        blockFormat.setLeftMargin(20);
        blockFormat.setRightMargin(20);

        if (msgType == ChatModel::User) {
            blockFormat.setBackground(QBrush(Qt::white));
            // Optional: Add a subtle right-side border for user messages
            blockFormat.setRightMargin(25);  // Make the user's box slightly smaller
        } else {
             blockFormat.setBackground(QBrush(QColor(230, 230, 230))); // Slightly grey for LLM
             blockFormat.setLeftMargin(25);
        }

        cursor.insertBlock(blockFormat);

        // --- Add text with styling ---
        QTextCharFormat charFormat;
        charFormat.setFont(QFont("Arial", 12)); // Choose a good font
        charFormat.setForeground(QBrush(Qt::white)); // Set text color to white
        cursor.setCharFormat(charFormat);

        // Add user/LLM label
        QString label = (msgType == ChatModel::User) ? "You: " : "LLM: ";
        cursor.insertText(label, charFormat);
        // Add the actual message.  Use insertHtml to handle preformatted text (like code)
        cursor.insertHtml(msgText.replace("\n", "<br>")); // Replace newlines with <br> for HTML
    }
     cursor.movePosition(QTextCursor::End);
     textEdit->setTextCursor(cursor); // Scroll to the bottom
}