#ifndef CHATMODEL_H
#define CHATMODEL_H

#include <QAbstractListModel>
#include <QObject>
#include <QVariant>
#include <QVector>

class ChatModel : public QAbstractListModel
{
    Q_OBJECT
    Q_PROPERTY(bool requestPending READ requestPending WRITE setRequestPending NOTIFY requestPendingChanged) // Add requestPending property

public:
    enum MessageType {
        User,
        LLM
    };

    struct Message {
        MessageType type;
        QString text;
    };

    explicit ChatModel(QObject *parent = nullptr);

    void addMessage(const QString& text, MessageType type);
    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;

    QHash<int, QByteArray> roleNames() const override;

    enum ChatRoles {
        MessageTypeRole = Qt::UserRole + 1,
        MessageTextRole
    };

    // Getter and Setter for requestPending
    bool requestPending() const { return m_requestPending; }
    void setRequestPending(bool value);

    signals:
        void requestPendingChanged(); // Signal emitted when requestPending changes

private:
    QVector<Message> m_messages;
    bool m_requestPending; // Add the member variable for requestPending
};

#endif // CHATMODEL_H