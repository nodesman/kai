// chatmodel.h
#ifndef CHATMODEL_H
#define CHATMODEL_H

#include <QAbstractListModel>
#include <QStringList>
#include <QVariant>

class ChatModel : public QAbstractListModel {
    Q_OBJECT

public:
    enum MessageType {
        User,
        LLM
    };
    enum ChatModelRoles {
        MessageTypeRole = Qt::UserRole + 1,
        MessageTextRole
    };

    ChatModel(QObject *parent = nullptr);

    // Add a message to the model
    void addMessage(MessageType type, const QString& text);

    // QAbstractItemModel interface
    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;
    QHash<int, QByteArray> roleNames() const override;

    //Property to indicate if there is a pending request
    Q_PROPERTY(bool requestPending READ requestPending WRITE setRequestPending NOTIFY requestPendingChanged)
    bool requestPending() const {return m_requestPending;}
    void setRequestPending(bool value);
    signals:
         void requestPendingChanged();
private:
    struct Message {
        MessageType type;
        QString text;
    };
    QList<Message> m_messages;
    bool m_requestPending; //Indicates a LLM request is pending.

};

#endif // CHATMODEL_H