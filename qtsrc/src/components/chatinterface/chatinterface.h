#ifndef CHATINTERFACE_H
#define CHATINTERFACE_H

#include <QWidget>
#include <QTextEdit> // Required for forward declaration
#include <QLabel>
#include "../../models/chatmodel.h"

class QVBoxLayout;  // Forward declaration
class QTextEdit;    // Forward declaration
class QLabel;       // Forward declaration
class QSplitter;
class ConversationHistory; // Forward Declaration

class ChatInterface : public QWidget
{
    Q_OBJECT

public:
    void setupUI();

    explicit ChatInterface(QWidget *parent = nullptr);
    void setModel(ChatModel *model);

signals:
    void sendMessage(const QString &message);
    void enterKeyPressed(); // New signal

protected:
    void keyPressEvent(QKeyEvent *event) override;

private slots:
    void handleRequestPendingChanged(); //Slot to handle state changes
    void updateStatus(const QString &statusMessage);
private:
    QVBoxLayout *mainLayout;
    QTextEdit *promptInput;
    QLabel *statusBar;
    ChatModel *chatModel;
    QSplitter *mainLayoutSplitter;
    ConversationHistory *conversationHistory;
};

#endif // CHATINTERFACE_H