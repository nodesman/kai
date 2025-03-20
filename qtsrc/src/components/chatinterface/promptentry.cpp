#include "promptentry.h"
#include <QTextDocument>
#include <QFontMetrics>
#include <QDebug>

PromptEntry::PromptEntry(QWidget *parent) : QTextEdit(parent) {
    //Set up max height for size hint calculation
    QFontMetrics metrics(this->font());
}

void PromptEntry::keyPressEvent(QKeyEvent *event) {
    if ((event->key() == Qt::Key_Return || event->key() == Qt::Key_Enter) &&
        event->modifiers() & Qt::ControlModifier) {
        emit sendRequested();
        return;
        }
    QTextEdit::keyPressEvent(event);
}