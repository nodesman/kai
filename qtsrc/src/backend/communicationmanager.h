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

class CommunicationManager : public QObject {
    Q_OBJECT

signals:
    void chatMessageReceived(const QString &message, int messageType);
    void requestStatusChanged(bool status);
    void errorReceived(const QString &errorMessage);
    void diffResultReceived(const QStringList& filePaths, const QList<QString>& fileContents);
    void diffApplied();

public:
    explicit CommunicationManager(QObject *parent = nullptr);
    ~CommunicationManager();

    ChatModel* getChatModel() const { return m_chatModel; }
    DiffModel* getDiffModel() const { return m_diffModel; }

    private slots:
        void readFile();
    void onFileChanged(const QString &path);

    public slots:
        void sendChatMessage(const QString &message);
    void applyDiff();
    void sendJson(const QJsonObject &obj);

private:
    QFile m_dataFile; // Regular QFile
    QFileSystemWatcher m_fileWatcher;
    ChatModel *m_chatModel;
    DiffModel *m_diffModel;
    const QString m_communicationFilePath; // Store the file path
};

#endif // COMMUNICATIONMANAGER_H