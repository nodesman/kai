#include "chatmodel.h"

ChatModel::ChatModel(QObject *parent)
    : QAbstractListModel(parent),
    m_requestPending(false)
{
}

void ChatModel::addMessage(MessageType type, const QString& text) {
    beginInsertRows(QModelIndex(), rowCount(), rowCount());
    m_messages.append({type, text});
    endInsertRows();
}

int ChatModel::rowCount(const QModelIndex &parent) const {
    Q_UNUSED(parent);
    return m_messages.size();
}

QVariant ChatModel::data(const QModelIndex &index, int role) const {
    if (!index.isValid() || index.row() < 0 || index.row() >= m_messages.size()) {
        return QVariant();
    }

    const Message& message = m_messages[index.row()];

    switch (role) {
        case MessageTypeRole:
            return static_cast<int>(message.type); // Important: Return as int
        case MessageTextRole:
            return message.text;
        default:
            return QVariant();
    }
}

QHash<int, QByteArray> ChatModel::roleNames() const {
    QHash<int, QByteArray> roles;
    roles[MessageTypeRole] = "messageType";
    roles[MessageTextRole] = "messageText";
    return roles;
}

void ChatModel::setRequestPending(bool value)
{
    if (m_requestPending != value)
    {
        m_requestPending = value;
        emit requestPendingChanged();
    }
}