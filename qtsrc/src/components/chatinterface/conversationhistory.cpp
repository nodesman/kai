// conversationhistory.cpp
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
#include <QTextDocumentFragment> // For HTML conversion
#include <QRegularExpression>  // For simple Markdown parsing
#include <Qt>
#include <QAbstractTextDocumentLayout> //for scroll

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
    //  Removed border: none;
    textEdit->setStyleSheet("background-color: lightgrey; color: black;");
    textEdit->document()->setDocumentMargin(10);  // Margin around the entire document
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

    if (!textEdit) {  // Check if textEdit is valid
        qDebug() << "textEdit is null, returning.";
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
        QModelIndex index = chatModel->index(i, 0);
        QVariant typeVariant = chatModel->data(index, ChatModel::MessageTypeRole);
        QVariant textVariant = chatModel->data(index, ChatModel::MessageTextRole);

        if (!typeVariant.isValid() || !textVariant.isValid()) {
            qDebug() << "WARNING: Invalid data for message" << i;
            continue;
        }

        ChatModel::MessageType msgType = static_cast<ChatModel::MessageType>(typeVariant.toInt());
        QString msgText = textVariant.toString();


        // --- Block Format (Spacing and Alignment) ---
        QTextBlockFormat blockFormat;
        blockFormat.setBottomMargin(10); // Space between messages
        if (msgType == ChatModel::User) {
            blockFormat.setAlignment(Qt::AlignRight);
        } else {
            blockFormat.setAlignment(Qt::AlignLeft);
        }
        cursor.insertBlock(blockFormat); // Apply block format *before* inserting content


        // --- Frame Format (Borders, Padding, Background) ---
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

        // --- Insert Frame ---
        QTextFrame *frame = cursor.insertFrame(frameFormat);
        QTextCursor frameCursor = frame->firstCursorPosition();

        // --- Text Format (Font) ---
        QTextCharFormat textFormat;
        textFormat.setFont(QFont("Verdana", 12));
        frameCursor.setCharFormat(textFormat);


        // --- HTML Content ---
        if (msgText.isEmpty()) {
            qDebug() << "WARNING: Message text is empty for message" << i;
            msgText = "[Empty message]";
        }

        // Convert Markdown to HTML *before* inserting into the document.
        QString html = convertMarkdownToHtml(msgText);
        frameCursor.insertHtml(html); // Insert as HTML


        // --- Move Cursor ---
        cursor = frame->lastCursorPosition(); // Crucial: Get the cursor *after* the frame.
        cursor.movePosition(QTextCursor::NextBlock);
    }


    // --- Scroll to End ---
    // Scroll to end
    QScrollBar *scrollBar = textEdit->verticalScrollBar();
    if (scrollBar)
    {
       scrollBar->setValue(scrollBar->maximum());
    }
    qDebug() << "History update complete";
}
QString ConversationHistory::convertMarkdownToHtml(const QString& markdown) {
    QString html = markdown;

    // --- Basic Markdown Support ---
    // Bold: **text**  -> <strong>text</strong>
    html.replace(QRegularExpression("\\*\\*(.*?)\\*\\*"), "<strong>\\1</strong>");

    // Italics: *text* -> <em>text</em>
    html.replace(QRegularExpression("\\*(.*?)\\*"), "<em>\\1</em>");
    html.replace(QRegularExpression("_(.*?)_"), "<em>\\1</em>"); // Also support _italics_

    // Strikethrough: ~~text~~ -> <del>text</del>
    html.replace(QRegularExpression("~~(.*?)~~"), "<del>\\1</del>");


    // Code blocks: `code` -> <pre><code>code</code></pre>  (multiline)
      html.replace(QRegularExpression("```([^`]*?)```", QRegularExpression::DotMatchesEverythingOption), "<pre><code style=\"background-color: #f0f0f0; display: block; white-space: pre-wrap;\">\\1</code></pre>");


    // Inline code: `code` -> <code>code</code>
    html.replace(QRegularExpression("`([^`]*)`"), "<code style=\"background-color: #f0f0f0;\">\\1</code>");


    // Headers: # Header -> <h1>Header</h1>, ## Header -> <h2>Header</h2>, etc.
    html.replace(QRegularExpression("^###### (.*)$", QRegularExpression::MultilineOption), "<h6>\\1</h6>");
    html.replace(QRegularExpression("^##### (.*)$", QRegularExpression::MultilineOption), "<h5>\\1</h5>");
    html.replace(QRegularExpression("^#### (.*)$", QRegularExpression::MultilineOption), "<h4>\\1</h4>");
    html.replace(QRegularExpression("^### (.*)$", QRegularExpression::MultilineOption), "<h3>\\1</h3>");
    html.replace(QRegularExpression("^## (.*)$", QRegularExpression::MultilineOption), "<h2>\\1</h2>");
    html.replace(QRegularExpression("^# (.*)$", QRegularExpression::MultilineOption), "<h1>\\1</h1>");

     //Unordered Lists
    QRegularExpression ulRegex("^[\\*\\-\\+]\\s+(.*)$", QRegularExpression::MultilineOption);
    html.replace(ulRegex, "<ul>\n<li>\\1</li>\n</ul>");
	// Fix for mulitple list entries.
    html.replace(QRegularExpression("<\\/ul>\\n<ul>", QRegularExpression::MultilineOption), "");


    //Ordered list
    QRegularExpression olRegex(R"(^\d+\.\s+(.*)$)", QRegularExpression::MultilineOption);
    html.replace(olRegex, "<ol>\n<li>\\1</li>\n</ol>");
    html.replace(QRegularExpression("</ol>\\n<ol>", QRegularExpression::MultilineOption), ""); //remove duplicates.


    // Links: [text](url) -> <a href="url">text</a>
    html.replace(QRegularExpression("\\[(.*?)\\]\\((.*?)\\)"), "<a href=\"\\2\">\\1</a>");

    // Images: ![alt text](url) -> <img src="url" alt="alt text">
    html.replace(QRegularExpression("!\\[(.*?)\\]\\((.*?)\\)"), "<img src=\"\\2\" alt=\"\\1\">");

    // --- Newlines ---
    // Replace \r\n and \n with <br> for line breaks.  Do this *after* block-level elements.
    html.replace("\r\n", "<br>");
    html.replace("\n", "<br>");

    return html;
}