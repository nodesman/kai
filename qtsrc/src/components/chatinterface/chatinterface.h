#ifndef CHATINTERFACE_H
#define CHATINTERFACE_H

#include <QWidget>
//Remove conversation history includes
// class QVBoxLayout;  <- No longer needed here
// class QTextEdit;  <- No longer needed here
class QLineEdit;
class QLabel;
class ChatModel;
class QKeyEvent;
class QVBoxLayout; // Add this
class QTextEdit;   // Add this
#include "conversationhistory.h" // Include the new component


class ChatInterface : public QWidget {
    Q_OBJECT

public:
    ChatInterface(QWidget *parent = nullptr);
    void setModel(ChatModel *model);

protected:
    void keyPressEvent(QKeyEvent *event) override;

    private slots:
        void onSendPrompt();
    void updateStatus(const QString& statusMessage);

    signals:
        void sendMessage();

private:
    QVBoxLayout *mainLayout;
    QTextEdit *promptInput; // Keep the prompt input
    QLabel *statusBar;
    ChatModel *chatModel;
    ConversationHistory *conversationHistory; // Use the new component

    void setupUI();
    //void updateConversationHistory(); // Removed
    void handleRequestPendingChanged();
};

#endif // CHATINTERFACE_H