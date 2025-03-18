#ifndef CHATINTERFACE_H
#define CHATINTERFACE_H

#include <QWidget>

class QVBoxLayout;
class QTextEdit;
class QLineEdit;
class QLabel;
class ChatModel; // Forward declare the ChatModel
class QKeyEvent;

class ChatInterface : public QWidget {
    Q_OBJECT

public:
    ChatInterface(QWidget *parent = nullptr);
    void setModel(ChatModel *model);

protected:
    void keyPressEvent(QKeyEvent *event) override;

    private slots:
        void onSendPrompt(); // Slot to handle sending the prompt.  No const.
    void updateStatus(const QString& statusMessage); //Slot to show messages in the status bar

    signals:
        void sendMessage(); // Signal to indicate a message should be sent

private:
    QVBoxLayout *mainLayout;
    QTextEdit *conversationHistory;
    QTextEdit *promptInput; // Change to QTextEdit
    QLabel *statusBar;      // Label for status messages
    ChatModel *chatModel;    // Pointer to the model

    void updateConversationHistory();  // No const
    void handleRequestPendingChanged();

    void setupUI();
};

#endif // CHATINTERFACE_H