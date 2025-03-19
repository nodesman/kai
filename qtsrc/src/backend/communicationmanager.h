#ifndef COMMUNICATIONMANAGER_H
#define COMMUNICATIONMANAGER_H

#include <QObject>
#include <QString>
#include <QJsonObject>
#include <QFile>
#include <QStringList>
#include "../models/chatmodel.h"
#include "../models/diffmodel.h"

class CommunicationManager : public QObject {
    Q_OBJECT

signals:
    void chatMessageReceived(const QString &message, int messageType);
    void requestStatusChanged(bool status); // Renamed signal
    void errorReceived(const QString &errorMessage);
    void diffResultReceived(const QStringList& filePaths, const QList<QString>& fileContents);
    void diffApplied(); // Signal for when diff is successfully applied
public:
    explicit CommunicationManager(QObject *parent = nullptr);
    ChatModel* getChatModel() const { return m_chatModel; }
    DiffModel* getDiffModel() const { return m_diffModel; }

    private slots:
        void readFromStdin();

    public slots:
        void sendChatMessage(const QString &message);
    void applyDiff();  // Renamed and simplified
    void sendJson(const QJsonObject &obj);

private:
    QFile m_stdinReader;
    ChatModel *m_chatModel;  // Use m_ prefix for member variables
    DiffModel *m_diffModel;
};

#endif // COMMUNICATIONMANAGER_H