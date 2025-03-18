#ifndef CONVERSATIONHISTORY_H
#define CONVERSATIONHISTORY_H

#include <QWidget>
#include <QTextEdit>
#include "../../models/chatmodel.h" // Include ChatModel

class ConversationHistory : public QWidget {
    Q_OBJECT

public:
    explicit ConversationHistory(QWidget *parent = nullptr);
    void setModel(ChatModel *model);

private:
    QTextEdit *textEdit;
    ChatModel *chatModel;

    void setupUI();
    void updateHistory();

    private slots:
        void onRowsInserted(const QModelIndex &parent, int first, int last);
};

#endif // CONVERSATIONHISTORY_H