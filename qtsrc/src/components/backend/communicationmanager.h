#ifndef COMMUNICATIONMANAGER_H
#define COMMUNICATIONMANAGER_H

#include <QObject>
#include <QString>
#include <QJsonObject> // Include QJsonObject here
#include <QFile>       // For standard input

class CommunicationManager : public QObject {
    Q_OBJECT

signals:
    void chatMessageReceived(const QString &message);
    void changesApplied(bool success);
    void requestPendingChanged(bool pending);
    void errorReceived(const QString &errorMessage);

public:
    explicit CommunicationManager(QObject *parent = nullptr); // Use explicit
    private slots:
        void readFromStdin();

    public slots:
        void sendChatMessage(const QString &message);
    void applyChanges(const QJsonObject &changes);
    void sendJson(const QJsonObject &obj);

private:
    QFile stdinReader;  // QFile, not a pointer.  Much simpler.
};

#endif // COMMUNICATIONMANAGER_H