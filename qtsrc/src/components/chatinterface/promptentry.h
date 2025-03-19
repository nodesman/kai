#ifndef PROMPTENTRY_H
#define PROMPTENTRY_H

#include <QTextEdit>
#include <QKeyEvent> // Include QKeyEvent

class PromptEntry : public QTextEdit {
    Q_OBJECT

public:
    explicit PromptEntry(QWidget *parent = nullptr);

    signals:
        void sendRequested(); // Signal to indicate the user wants to send

protected:
    void keyPressEvent(QKeyEvent *event) override;
};

#endif // PROMPTENTRY_H