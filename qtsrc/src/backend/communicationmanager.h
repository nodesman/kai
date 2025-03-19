#ifndef COMMUNICATIONMANAGER_H
#define COMMUNICATIONMANAGER_H

#include <QObject>
#include <QString>
#include <QJsonObject>
#include <QFile>
#include <QStringList>
#include "../models/chatmodel.h" // Include ChatModel here
#include "../models/diffmodel.h"

class CommunicationManager : public QObject {
    Q_OBJECT

signals:
    // Keep these signals; they're how the models get updated.
    void chatMessageReceived(const QString &message, int messageType);
    void requestPendingChanged(bool pending);
    void errorReceived(const QString &errorMessage);
    void diffResultReceived(const QStringList& filePaths, const QList<QString>& fileContents);
    void changesApplied(bool applied);
public:
    explicit CommunicationManager(QObject *parent = nullptr);
    ChatModel* getChatModel() const { return chatModel; } // Add a getter
    DiffModel* getDiffModel() const { return diffModel; }


    private slots:
        void readFromStdin();

public slots:
    void sendChatMessage(const QString &message); // Keep this
    void applyChanges(const QJsonObject &changes);  // Keep this
    void sendJson(const QJsonObject &obj);         // Keep this

private:
    QFile stdinReader;
    ChatModel *chatModel; // Keep the models *separate* from CommunicationManager
    DiffModel *diffModel;
};

#endif // COMMUNICATIONMANAGER_H