#ifndef COMMUNICATIONMANAGER_H
#define COMMUNICATIONMANAGER_H

#include <QObject>
#include <QString>
#include <QJsonObject>
#include <QFile>
#include <QFileSystemWatcher>
#include <QStringList>
#include "../models/chatmodel.h"
#include "../models/diffmodel.h"
#include <QSocketNotifier>
#include <QTextStream>
#include <QLocalServer>
#include <QLocalSocket>
#include <QThread> // Required for msleep

class CommunicationManager : public QObject {
    Q_OBJECT

signals:
    void chatMessageReceived(const QString &message, int messageType);
    void requestStatusChanged(bool status);
    void errorReceived(const QString &errorMessage);
    void diffResultReceived(const QStringList& filePaths, const QList<QString>& fileContents);
    void diffApplied();
    void serverReady(); // NEW SIGNAL: emitted when the server is ready

public:
    void initializeWithHardcodedData();

    explicit CommunicationManager(QObject *parent = nullptr, DiffModel *diffModel = nullptr, ChatModel *chatModel = nullptr);

    ~CommunicationManager();

    ChatModel* getChatModel() const { return m_chatModel; }
    DiffModel* getDiffModel() const { return m_diffModel; }

    public slots:
        void sendChatMessage(const QString &message);
    void applyDiff();
    void sendJson(const QJsonObject &obj);

    void processReceivedJson(const QJsonObject &obj);

    private slots:
        void handleNewConnection();
    void readFromSocket();
    void clientDisconnected();
    void socketError(QLocalSocket::LocalSocketError socketError);

private:
    ChatModel *m_chatModel;
    DiffModel *m_diffModel;
    QLocalServer *m_server;
    QLocalSocket *m_clientSocket;

};

#endif // COMMUNICATIONMANAGER_H