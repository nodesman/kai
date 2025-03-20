#ifndef PROMPTENTRY_H
#define PROMPTENTRY_H

#include <QTextEdit>
#include <QKeyEvent>
#include <QTimer> // Include QTimer

class PromptEntry : public QTextEdit {
    Q_OBJECT

public:
    explicit PromptEntry(QWidget *parent = nullptr);

    signals:
        void sendRequested();

protected:
    void keyPressEvent(QKeyEvent *event) override;

    private slots:

private:
};

#endif // PROMPTENTRY_H