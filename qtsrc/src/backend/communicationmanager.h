#ifndef COMMUNICATIONMANAGER_H
#define COMMUNICATIONMANAGER_H

#include <QObject>
#include <QStringList>
#include <QJsonObject>
#include "../models/chatmodel.h"
#include "../models/diffmodel.h"
#include <QAbstractSocket>

class QWebSocket; // Forward declaration
class QUrl;

// Forward declaration of Private *OUTSIDE* CommunicationManager
class CommunicationManagerPrivate;

class CommunicationManager : public QObject {
    Q_OBJECT

public:
    explicit CommunicationManager(QObject *parent = nullptr, DiffModel *diffModel = nullptr, ChatModel *chatModel = nullptr);
    ~CommunicationManager();

    void sendChatMessage(const QString &message);
    void applyDiff();
    void initializeWithHardcodedData();

    ChatModel* getChatModel() const { return m_chatModel; }
    DiffModel* getDiffModel() const { return m_diffModel; }

    signals:
        void chatMessageReceived(const QString &message, int messageType);
    void requestStatusChanged(bool status);
    void diffResultReceived(const QStringList &filePaths, const QList<QString> &fileContents);
    void diffApplied();
    void errorReceived(const QString &errorMessage);
    void ready();

    private slots:
        void onConnected();
    void onDisconnected();
    void onTextMessageReceived(const QString &message);
    void onError(QAbstractSocket::SocketError error);
    void sendReadySignal();
    void processReceivedJson(const QJsonObject &obj);
    void sendJson(const QJsonObject &obj);

private:
    //  Private *d;  // INCORRECT -  d is now of type CommunicationManagerPrivate*
    CommunicationManagerPrivate *d; // CORRECT - Pointer to the private implementation

    ChatModel *m_chatModel;
    DiffModel *m_diffModel;
};

#endif // COMMUNICATIONMANAGER_H