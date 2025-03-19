#ifndef CHATINTERFACE_H
#define CHATINTERFACE_H

#include <QWidget>
#include <QTextEdit>
#include <QLabel>

#include "promptentry.h"
#include "../../models/chatmodel.h"
class QVBoxLayout;
class ConversationHistory; // Forward declaration

class ChatInterface : public QWidget
{
    Q_OBJECT

public:
    explicit ChatInterface(QWidget *parent = nullptr);
    void setupUI();
    void setModel(ChatModel *model);

signals:
    void sendMessage(const QString &message);

protected:
private slots:

    void updateStatus(const QString &statusMessage);
    // void onChatMessageReceived(const QString& message, int messageType);
public slots:
    void updateChatHistory();
    void handleRequestPendingChanged();
private:
    QVBoxLayout *mainLayout;
    PromptEntry *promptInput;
    QLabel *statusBar;
    ChatModel *chatModel;
    ConversationHistory* conversationHistory;  //No need of this if mainwindow handles.

};
#endif // CHATINTERFACE_H