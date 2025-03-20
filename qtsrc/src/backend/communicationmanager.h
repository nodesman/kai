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

class CommunicationManager : public QObject {
    Q_OBJECT

signals:
    void chatMessageReceived(const QString &message, int messageType);
    void requestStatusChanged(bool status);
    void errorReceived(const QString &errorMessage);
    void diffResultReceived(const QStringList& filePaths, const QList<QString>& fileContents);
    void diffApplied();
    void ready(); // Add this signal

public:
    void initializeWithHardcodedData();

    explicit CommunicationManager(QObject *parent = nullptr, DiffModel *diffModel = nullptr, ChatModel *chatModel = nullptr);

    void sendReadySignal();

    void readStdin();

    void handleActivated(QSocketDescriptor socket, QSocketNotifier::Type type);

    ~CommunicationManager();

    ChatModel* getChatModel() const { return m_chatModel; }
    DiffModel* getDiffModel() const { return m_diffModel; }


public slots:
    void sendChatMessage(const QString &message);
    void applyDiff();
    void sendJson(const QJsonObject &obj);

    void processReceivedJson(const QJsonObject &obj);

private:
    QSocketNotifier *m_stdinNotifier; // Add this
    QTextStream *m_stdinStream; // Add this
    ChatModel *m_chatModel;
    DiffModel *m_diffModel;
    QTextStream * m_stdoutStream;
};

#endif // COMMUNICATIONMANAGER_H