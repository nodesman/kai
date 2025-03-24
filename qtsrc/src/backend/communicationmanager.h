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

    ChatModel* getChatModel() const { return m_chatModel; }
    DiffModel* getDiffModel() const { return m_diffModel; }

    signals:
        void chatMessageReceived(const QString &message, int messageType);
    void requestStatusChanged(bool status);
    void diffResultReceived(const QStringList &filePaths, const QList<QString> &fileContents);
    void diffApplied();
    void errorReceived(const QString &errorMessage);
    void ready();

    public slots: // Changed to public slots
        void sendChatMessage(const QString &message);
    void applyChanges(); // Renamed slot
    void initializeWithHardcodedData();
    void sendReadySignal();

    private slots:
        void onConnected();
    void onDisconnected();
    void onTextMessageReceived(const QString &message);
    void onError(QAbstractSocket::SocketError error);
    void processReceivedJson(const QJsonObject &obj);
    void sendJson(const QJsonObject &obj);

private:
    CommunicationManagerPrivate *d; // Pointer to the private implementation

    ChatModel *m_chatModel;
    DiffModel *m_diffModel;
};

#endif // COMMUNICATIONMANAGER_H