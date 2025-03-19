#include "promptentry.h"

PromptEntry::PromptEntry(QWidget *parent) : QTextEdit(parent) {
    // You can set any default properties for the QTextEdit here, if needed.
    // For example:
    // setFont(...);
    // setPlaceholderText("Enter your message...");
}

void PromptEntry::keyPressEvent(QKeyEvent *event) {
    if (event->key() == Qt::Key_Return || event->key() == Qt::Key_Enter) {
        if (event->modifiers() & Qt::ControlModifier) { // Or Qt::ShiftModifier
            emit sendRequested();
            return; // Consume the event
        }
    }
    QTextEdit::keyPressEvent(event); // Call base class implementation
}